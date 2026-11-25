import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { messages } from '../src/site/messages'
import { newTotpSecret } from './support/totp'
import { passwordLogin, sameOrigin, setCookie, totpLogin } from './support/admin-session'
import { totpCode } from './support/totp'
import { present } from './support/present'

// Against the production build with payload-totp active. This script only prepares and inspects
// the database through the Local API (run with PAYLOAD_TOTP_DISABLED=true); every check below goes
// through HTTP, where the server enforces the second factor.
if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Une base isolée finissant par _test est requise.')
const origin = process.env['TEST_ORIGIN'] || 'http://localhost:3201'
const payload = await getPayload({ config })

const get = (path: string, cookie = '') =>
  fetch(origin + path, { headers: sameOrigin(origin, cookie), redirect: 'manual' })
const post = (path: string, cookie: string, body?: unknown) =>
  fetch(origin + path, {
    method: 'POST',
    headers: sameOrigin(origin, cookie, true),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
const secretOf = async (id: number) =>
  (await payload.findByID({ collection: 'users', id, showHiddenFields: true })).totpSecret ?? null

try {
  const accounts = await Promise.all(
    ['a', 'b'].map(async (name) => {
      const password = randomBytes(24).toString('hex')
      const user = await payload.create({
        collection: 'users',
        data: {
          email: `totp-${name}-${randomBytes(4).toString('hex')}@example.test`,
          name: `TOTP ${name}`,
          role: 'admin',
          password,
        },
      })
      return { ...user, password }
    }),
  )
  const [a, b] = [present(accounts[0]), present(accounts[1])]
  await payload.updateGlobal({ slug: 'site-settings', data: { maintenance: true } })

  // The public site stays readable without any session (opt-out of the wrapper, reads only).
  for (const path of [
    '/api/globals/site-content',
    '/api/globals/site-settings',
    '/api/globals/legal-pages',
    '/api/media',
  ])
    assert.equal((await get(path)).status, 200, `${path} lisible anonymement`)
  assert.equal((await get('/api/globals/order-settings')).status, 403)
  assert.equal((await get('/api/users')).status, 403)

  // Password only, not enrolled: held back everywhere except its own account document.
  const aPassword = await passwordLogin(origin, a.email, a.password)
  const ownOnly = (await (await get('/api/users', aPassword)).json()) as { docs: { id: number }[] }
  assert.deepEqual(
    ownOnly.docs.map((doc) => doc.id),
    [a.id],
    'Seul son propre compte pendant la configuration',
  )
  for (const path of ['/api/globals/order-settings', '/api/orders', '/api/customer-photos'])
    assert.equal((await get(path, aPassword)).status, 403, `${path} refusé sans TOTP`)
  assert.equal(
    (await post('/api/globals/site-content', aPassword, { title: 'Interdit' })).status,
    403,
    'Écriture refusée sans TOTP',
  )
  assert.notEqual(
    (await get('/api/payload-jobs/run?queue=commerce', aPassword)).status,
    200,
    'Jobs refusés sans TOTP',
  )
  const toSetup = await get('/admin', aPassword)
  assert.equal(toSetup.status, 307)
  assert.match(toSetup.headers.get('location') ?? '', /\/admin\/setup-totp\?back=%2Fadmin$/)
  const setupPage = await (await get('/admin/setup-totp', aPassword)).text()
  assert.match(
    setupPage,
    /gestionnaire de mots de passe/,
    'Conseil du gestionnaire de mots de passe',
  )
  const maintenance = await (await get('/fr', aPassword)).text()
  assert.ok(maintenance.includes(messages.fr.maintenanceTitle), 'Maintenance sans TOTP')
  assert.equal(
    (await post('/api/users/invite', aPassword, { email: 'x@example.test', name: 'X' })).status,
    403,
  )
  assert.equal((await post(`/api/users/${b.id}/reset-totp`, aPassword)).status, 403)

  // Enrolled and verified: full access, jobs included.
  const aSession = await totpLogin(origin, a.email, a.password)
  assert.ok(await secretOf(a.id), 'Clé enregistrée côté serveur')
  assert.equal((await get('/api/users', aSession.cookie)).status, 200)
  assert.equal((await get('/api/globals/order-settings', aSession.cookie)).status, 200)
  assert.equal((await get('/api/payload-jobs/run?queue=commerce', aSession.cookie)).status, 200)
  assert.equal((await get('/admin', aSession.cookie)).status, 200)
  assert.ok(
    !(await (await get('/fr', aSession.cookie)).text()).includes(messages.fr.maintenanceTitle),
  )

  // Enrolled, new password session: verify view, wrong code refused, right code accepted.
  const bFirst = await totpLogin(origin, b.email, b.password)
  const bPassword = await passwordLogin(origin, b.email, b.password)
  assert.equal((await get('/api/globals/order-settings', bPassword)).status, 403)
  const toVerify = await get('/admin', bPassword)
  assert.match(toVerify.headers.get('location') ?? '', /\/admin\/verify-totp/)
  const wrongCode = String((Number(totpCode(bFirst.secret)) + 500_000) % 1_000_000).padStart(6, '0')
  assert.equal(
    (
      (await (await post('/api/verify-totp', bPassword, { token: wrongCode })).json()) as {
        ok: boolean
      }
    ).ok,
    false,
  )
  const bSession = await totpLogin(origin, b.email, b.password, bFirst.secret)
  assert.equal((await get('/api/globals/order-settings', bSession.cookie)).status, 200)

  // Enrolled account, password only: cannot enrol another device over the existing secret.
  const bSecret = await secretOf(b.id)
  const otherSecret = newTotpSecret()
  const reEnrol = await post('/api/setup-totp', bPassword, {
    secret: otherSecret,
    token: totpCode(otherSecret),
  })
  assert.equal(((await reEnrol.json()) as { ok: boolean }).ok, false)
  assert.equal(await secretOf(b.id), bSecret, 'Clé inchangée')
  // GraphQL: disabled in the configuration and not mounted (no /api/graphql route); whatever
  // answers, no data leaks.
  assert.equal(payload.config.graphQL.disable, true, 'GraphQL désactivé')
  const graphql = await post('/api/graphql', bPassword, {
    query: '{ Users { docs { id email } } }',
  })
  const graphqlText = await graphql.text()
  assert.ok(!graphqlText.includes(b.email), 'GraphQL ne renvoie aucun compte sans TOTP')
  assert.ok(
    graphql.status >= 400 || graphqlText.includes('"errors"'),
    `GraphQL refusé sans TOTP (${String(graphql.status)})`,
  )
  // Password only: an existing email is refused for lack of TOTP, never reported as a duplicate.
  assert.equal(
    (await post('/api/users/invite', aPassword, { email: b.email, name: 'X' })).status,
    403,
  )

  // Phone lost: another verified administrator resets the secret; never one's own.
  const own = await post(`/api/users/${a.id}/reset-totp`, aSession.cookie)
  assert.equal(own.status, 403)
  for (const id of [`0${String(a.id)}`, '9999999999', '99999999999'])
    assert.equal((await post(`/api/users/${id}/reset-totp`, aSession.cookie)).status, 404, id)
  assert.ok(await secretOf(a.id), 'Sa propre clé reste en place')
  const recovery = await post(`/api/users/${b.id}/reset-totp`, aSession.cookie)
  assert.equal(recovery.status, 200)
  assert.equal(recovery.headers.get('cache-control'), 'no-store')
  const recoveryBody = (await recovery.json()) as { delivery: string; link: string }
  assert.equal(recoveryBody.delivery, 'link', 'Mode simulé : lien remis à l’administrateur')
  assert.equal(await secretOf(b.id), null, 'Clé effacée')
  assert.equal(
    (await get('/api/globals/order-settings', bSession.cookie)).status,
    403,
    'Les sessions de la personne réinitialisée sont fermées',
  )
  const oldPassword = await fetch(`${origin}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: b.email, password: b.password }),
  })
  assert.equal(oldPassword.status, 401, 'Ancien mot de passe invalidé')
  const bNewPassword = randomBytes(18).toString('hex')
  const chosen = await fetch(`${origin}/api/users/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: present(/\/admin\/reset\/([a-f0-9]{40})$/.exec(recoveryBody.link)?.[1]),
      password: bNewPassword,
    }),
  })
  assert.equal(chosen.status, 200)
  // The old TOTP cookie over the fresh session: no secret any more, so it counts for nothing.
  const oldTotp = present(/payload-totp=[^;]+/.exec(bSession.cookie)?.[0])
  const replayed = `payload-token=${present(setCookie(chosen, 'payload-token'))}; ${oldTotp}`
  assert.equal((await get('/api/globals/order-settings', replayed)).status, 403)
  assert.equal(
    (await post('/api/users/invite', replayed, { email: 'replay@example.test', name: 'X' })).status,
    403,
  )
  assert.equal((await post(`/api/users/${a.id}/reset-totp`, replayed)).status, 403)
  assert.match((await get('/admin', replayed)).headers.get('location') ?? '', /\/admin\/setup-totp/)
  await totpLogin(origin, b.email, bNewPassword)

  // Reset-password pages: no Referer (the token is in the path) and no cache.
  const resetPage = await get('/admin/reset/0000000000000000000000000000000000000000')
  assert.equal(resetPage.headers.get('referrer-policy'), 'no-referrer')
  assert.match(resetPage.headers.get('cache-control') ?? '', /no-store/)

  // Invitation by a verified administrator: simulated email, the link comes back once.
  assert.equal(
    (await post('/api/users/invite', '', { email: 'anon@example.test', name: 'X' })).status,
    403,
  )
  const invited = await post('/api/users/invite', aSession.cookie, {
    email: 'invite.http@example.test',
    name: 'Invitée HTTP',
  })
  assert.equal(invited.status, 201)
  assert.equal(invited.headers.get('cache-control'), 'no-store')
  const invitation = (await invited.json()) as { delivery: string; link: string }
  assert.equal(invitation.delivery, 'link')
  const token = present(/\/admin\/reset\/([a-f0-9]{40})$/.exec(invitation.link)?.[1])
  assert.ok(invitation.link.startsWith(`${origin}/admin/reset/`))
  assert.equal((await get(new URL(invitation.link).pathname)).status, 200, 'Page de mot de passe')
  assert.equal(
    (
      await post('/api/users/invite', aSession.cookie, {
        email: 'invite.http@example.test',
        name: 'X',
      })
    ).status,
    409,
  )
  const invitePassword = randomBytes(18).toString('hex')
  const reset = (password: string) =>
    fetch(`${origin}/api/users/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password }),
    })
  assert.equal((await reset('court')).status, 400, '12 caractères minimum')
  assert.equal((await reset(invitePassword)).status, 200)
  assert.equal((await reset(randomBytes(18).toString('hex'))).status, 403, 'Lien à usage unique')
  // First login of the invitee: TOTP enrolment before anything else.
  const inviteePassword = await passwordLogin(origin, 'invite.http@example.test', invitePassword)
  assert.match(
    (await get('/admin', inviteePassword)).headers.get('location') ?? '',
    /\/admin\/setup-totp/,
  )
  assert.equal((await get('/api/globals/order-settings', inviteePassword)).status, 403)
  const invitee = await totpLogin(origin, 'invite.http@example.test', invitePassword)
  assert.equal((await get('/api/globals/order-settings', invitee.cookie)).status, 200)

  await payload.updateGlobal({ slug: 'site-settings', data: { maintenance: false } })
  console.log(
    'Vérifications réussies : site public anonyme, session sans TOTP refusée (API, jobs, maintenance, admin), enrôlement et vérification, réinitialisation croisée, invitation par lien à usage unique puis enrôlement.',
  )
} finally {
  await payload.destroy()
}
