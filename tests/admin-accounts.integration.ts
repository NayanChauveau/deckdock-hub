import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import {
  createLocalReq,
  getPayload,
  type Payload,
  type PayloadRequest,
  type SendEmailOptions,
} from 'payload'
import config from '../src/payload.config'
import { INVITATION_LIFETIME_MS, inviteAdministrator } from '../src/core/admin/invitations'
import { resetUserTotp } from '../src/core/admin/totp-recovery'
import { resetAdminPassword } from '../src/core/admin/reset-admin-password'
import { present } from './support/present'

// Local API scenarios: the suite runs this script with PAYLOAD_TOTP_DISABLED=true (NODE_ENV=test).
// The same rules with the plugin active are proven over HTTP in tests/admin-access.integration.ts.
if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Une base isolée finissant par _test est requise.')
const payload = await getPayload({ config })

/** Everything Payload or our code logs during the scenario, to prove the token never appears. */
const logged: string[] = []
for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const) {
  const original = payload.logger[level].bind(payload.logger)
  payload.logger[level] = (...args: unknown[]) => {
    logged.push(
      JSON.stringify(args, (_key, value: unknown) =>
        value instanceof Error ? `${value.message} ${value.stack ?? ''}` : value,
      ),
    )
    Reflect.apply(original, payload.logger, args)
  }
}
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '))
    original(...args)
  }
}

/** Real delivery as the SMTP adapter would do it, captured instead of sent. */
function deliverWith(target: Payload, send: (message: SendEmailOptions) => Promise<unknown>) {
  const email = target.email
  const sendEmail = target.sendEmail
  target.email = { ...email, name: 'smtp', sendEmail: send }
  target.sendEmail = send
  return () => {
    target.email = email
    target.sendEmail = sendEmail
  }
}

const tokenOf = (link: string) => present(/\/admin\/reset\/([a-f0-9]{40})$/.exec(link)?.[1])
const userByEmail = async (email: string) =>
  present(
    (
      await payload.find({
        collection: 'users',
        where: { email: { equals: email } },
        showHiddenFields: true,
        limit: 1,
      })
    ).docs[0],
  )

try {
  const admin = await payload.create({
    collection: 'users',
    data: {
      email: `inviter-${randomBytes(4).toString('hex')}@example.test`,
      name: 'Administrateur invitant',
      role: 'admin',
      password: randomBytes(24).toString('hex'),
    },
  })
  const asAdmin = async () => createLocalReq({ user: { ...admin, collection: 'users' } }, payload)
  const tokens: string[] = []

  // Simulated email (the suite and production today): the link comes back once, nothing is sent.
  let sent = 0
  const restoreSimulated = deliverWith(payload, async () => {
    sent++
    return Promise.resolve()
  })
  restoreSimulated()
  assert.equal(payload.email.name, 'simulated', 'La suite tourne en EMAIL_MODE=simulated')
  const before = Date.now()
  const simulated = await inviteAdministrator(await asAdmin(), {
    email: ' Invite.Lien@Example.test ',
    name: 'Invitée lien',
  })
  assert.equal(simulated.email, 'invite.lien@example.test')
  assert.ok(simulated.delivery === 'link')
  assert.ok(simulated.link.startsWith(`${payload.config.serverURL}/admin/reset/`))
  const linkToken = tokenOf(simulated.link)
  tokens.push(linkToken)
  assert.equal(sent, 0, 'Aucun envoi en mode simulé')
  const invitee = await userByEmail('invite.lien@example.test')
  assert.equal(invitee.role, 'admin')
  assert.equal(invitee.name, 'Invitée lien')
  const expiresIn = new Date(present(invitee.resetPasswordExpiration)).getTime() - before
  assert.ok(
    Math.abs(expiresIn - INVITATION_LIFETIME_MS) < 60_000,
    'Lien valable 24 h, pas une heure comme un mot de passe oublié',
  )
  // The random initial password is unknown: no way in before the link is used.
  await assert.rejects(
    payload.login({ collection: 'users', data: { email: invitee.email, password: '' } }),
  )

  // The link is Payload's reset-password token: once, with the 12-character rule.
  const chosen = randomBytes(18).toString('hex')
  await assert.rejects(
    payload.resetPassword({
      collection: 'users',
      data: { token: linkToken, password: 'trop-court' },
      overrideAccess: true,
    }),
    /12 caractères/,
  )
  await payload.resetPassword({
    collection: 'users',
    data: { token: linkToken, password: chosen },
    overrideAccess: true,
  })
  assert.ok(
    (await payload.login({ collection: 'users', data: { email: invitee.email, password: chosen } }))
      .token,
  )
  await assert.rejects(
    payload.resetPassword({
      collection: 'users',
      data: { token: linkToken, password: randomBytes(18).toString('hex') },
      overrideAccess: true,
    }),
    /invalid or has expired/,
    'Lien à usage unique',
  )

  // Expired link: refused, the account keeps its unknown password.
  const late = await inviteAdministrator(await asAdmin(), {
    email: 'invite.expire@example.test',
    name: 'Invité expiré',
  })
  assert.ok(late.delivery === 'link')
  const lateToken = tokenOf(late.link)
  tokens.push(lateToken)
  const lateUser = await userByEmail('invite.expire@example.test')
  await payload.update({
    collection: 'users',
    id: lateUser.id,
    data: { resetPasswordExpiration: new Date(Date.now() - 1000).toISOString() },
  })
  await assert.rejects(
    payload.resetPassword({
      collection: 'users',
      data: { token: lateToken, password: randomBytes(18).toString('hex') },
      overrideAccess: true,
    }),
    /invalid or has expired/,
  )

  // Real delivery (EMAIL_MODE=smtp): the email carries the link, the answer does not.
  const messages: SendEmailOptions[] = []
  const restoreSMTP = deliverWith(payload, async (message) => {
    messages.push(message)
    return Promise.resolve({ accepted: [message.to] })
  })
  const emailed = await inviteAdministrator(await asAdmin(), {
    email: 'invite.email@example.test',
    name: 'Invité <b>email</b>',
  })
  restoreSMTP()
  assert.deepEqual(emailed, { email: 'invite.email@example.test', delivery: 'email' })
  assert.ok(!('link' in emailed))
  assert.equal(messages.length, 1)
  const message = present(messages[0])
  assert.equal(message.to, 'invite.email@example.test')
  assert.match(String(message.subject), /Invitation/)
  const html = typeof message.html === 'string' ? message.html : ''
  assert.match(html, /invité\(e\) à administrer/)
  assert.match(html, /invited to administer/)
  assert.match(html, /gestionnaire de mots de passe/)
  assert.ok(!html.includes('<b>email</b>'), 'Nom échappé dans le HTML')
  assert.ok(!/réinitialis/i.test(html), 'Une invitation, pas une réinitialisation')
  const emailedLink = present(/href="([^"]+)"/.exec(html)?.[1])
  const emailedToken = tokenOf(emailedLink)
  tokens.push(emailedToken)
  assert.ok(typeof message.text === 'string' && message.text.includes(emailedLink))
  await payload.resetPassword({
    collection: 'users',
    data: { token: emailedToken, password: randomBytes(18).toString('hex') },
    overrideAccess: true,
  })

  // A delivery failure creates nothing.
  const restoreFailure = deliverWith(payload, async () => Promise.reject(new Error('SMTP down')))
  await assert.rejects(
    inviteAdministrator(await asAdmin(), { email: 'invite.echec@example.test', name: 'Échec' }),
    (error: unknown) => error instanceof Error && 'status' in error && error.status === 502,
  )
  restoreFailure()
  assert.equal(
    (
      await payload.count({
        collection: 'users',
        where: { email: { equals: 'invite.echec@example.test' } },
      })
    ).totalDocs,
    0,
  )

  // Only administrators invite; duplicates and malformed input are refused.
  const forbidden = (error: unknown) =>
    error instanceof Error && 'status' in error && error.status === 403
  await assert.rejects(
    inviteAdministrator(await createLocalReq({}, payload), {
      email: 'anonyme@example.test',
      name: 'X',
    }),
    forbidden,
  )
  const notAdmin = {
    ...admin,
    role: 'editor',
    collection: 'users',
  } as unknown as NonNullable<PayloadRequest['user']>
  await assert.rejects(
    inviteAdministrator(await createLocalReq({ user: notAdmin }, payload), {
      email: 'editeur@example.test',
      name: 'X',
    }),
    forbidden,
  )
  await assert.rejects(
    inviteAdministrator(await asAdmin(), { email: 'invite.lien@example.test', name: 'Doublon' }),
    (error: unknown) => error instanceof Error && 'status' in error && error.status === 409,
  )
  await assert.rejects(
    inviteAdministrator(await asAdmin(), { email: 'pas-un-email', name: 'X' }),
    (error: unknown) => error instanceof Error && 'status' in error && error.status === 400,
  )
  for (const email of ['anonyme@example.test', 'editeur@example.test', 'pas-un-email'])
    assert.equal(
      (await payload.count({ collection: 'users', where: { email: { equals: email } } })).totalDocs,
      0,
    )

  // TOTP reset by another administrator: only from a session that entered its code, never for oneself.
  await payload.update({
    collection: 'users',
    id: invitee.id,
    overrideAccess: true,
    data: { totpSecret: 'JBSWY3DPEHPK3PXP' },
  })
  const secretOf = async (id: number) =>
    (
      await payload.findByID({
        collection: 'users',
        id,
        showHiddenFields: true,
        overrideAccess: true,
      })
    ).totpSecret ?? null
  const session = async (strategy: string, user = admin, hasTotp = true) =>
    createLocalReq(
      {
        user: {
          ...user,
          collection: 'users',
          _strategy: strategy,
          hasTotp,
        } as PayloadRequest['user'] & object,
      },
      payload,
    )
  const status = (code: number) => (error: unknown) =>
    error instanceof Error && 'status' in error && error.status === code
  await assert.rejects(resetUserTotp(await session('local-jwt'), invitee.id), forbidden)
  await assert.rejects(resetUserTotp(await asAdmin(), invitee.id), forbidden)
  await assert.rejects(resetUserTotp(await createLocalReq({}, payload), invitee.id), forbidden)
  // An old TOTP cookie over a fresh password session of an account without a secret.
  await assert.rejects(resetUserTotp(await session('totp', admin, false), invitee.id), forbidden)
  assert.equal(await secretOf(invitee.id), 'JBSWY3DPEHPK3PXP', 'Rien effacé sans TOTP')
  await assert.rejects(
    resetUserTotp(await session('totp', invitee), invitee.id),
    /propre double authentification/,
  )
  // Ids are validated strictly: no leading zero (self-reset bypass), no out-of-range value (500).
  for (const id of [`0${String(admin.id)}`, '9999999999', '99999999999', '-1', '1e3', ''])
    await assert.rejects(resetUserTotp(await session('totp'), id), status(404), id)
  assert.equal(await secretOf(invitee.id), 'JBSWY3DPEHPK3PXP', 'Pas pour son propre compte')
  const beforeReset = Date.now()
  const recovery = await resetUserTotp(await session('totp'), invitee.id)
  assert.equal(await secretOf(invitee.id), null)
  const reset = await userByEmail(invitee.email)
  assert.equal(reset.sessions?.length ?? 0, 0, 'Sessions fermées')
  // The old password no longer works: re-enrolment goes through a fresh set-password link.
  await assert.rejects(
    payload.login({ collection: 'users', data: { email: invitee.email, password: chosen } }),
  )
  assert.ok(recovery.delivery === 'link', 'Mode simulé : lien remis à l’administrateur')
  const recoveryToken = tokenOf(recovery.link)
  tokens.push(recoveryToken)
  assert.ok(
    Math.abs(
      new Date(present(reset.resetPasswordExpiration)).getTime() -
        beforeReset -
        INVITATION_LIFETIME_MS,
    ) < 60_000,
  )
  const recoveredPassword = randomBytes(18).toString('hex')
  await payload.resetPassword({
    collection: 'users',
    data: { token: recoveryToken, password: recoveredPassword },
    overrideAccess: true,
  })
  await assert.rejects(
    payload.resetPassword({
      collection: 'users',
      data: { token: recoveryToken, password: randomBytes(18).toString('hex') },
      overrideAccess: true,
    }),
    /invalid or has expired/,
  )
  // Real delivery: the link goes to the account's own address, the administrator never sees it.
  const resetMessages: SendEmailOptions[] = []
  const restoreResetSMTP = deliverWith(payload, async (message) => {
    resetMessages.push(message)
    return Promise.resolve({})
  })
  const emailedRecovery = await resetUserTotp(await session('totp'), invitee.id)
  restoreResetSMTP()
  assert.deepEqual(emailedRecovery, { delivery: 'email' })
  const resetMessage = present(resetMessages[0])
  assert.equal(resetMessage.to, invitee.email)
  const resetHTML = typeof resetMessage.html === 'string' ? resetMessage.html : ''
  assert.match(resetHTML, /a réinitialisé votre double authentification/)
  assert.match(resetHTML, /reset your two-factor authentication/)
  const emailedResetToken = tokenOf(present(/href="([^"]+)"/.exec(resetHTML)?.[1]))
  tokens.push(emailedResetToken)
  // A delivery failure leaves everything as it was (one transaction).
  await payload.update({
    collection: 'users',
    id: invitee.id,
    overrideAccess: true,
    data: { totpSecret: 'JBSWY3DPEHPK3PXP' },
  })
  const restoreResetFailure = deliverWith(payload, async () => Promise.reject(new Error('down')))
  await assert.rejects(resetUserTotp(await session('totp'), invitee.id), status(502))
  restoreResetFailure()
  assert.equal(await secretOf(invitee.id), 'JBSWY3DPEHPK3PXP', 'Rien effacé si l’email échoue')
  assert.ok(logged.some((line) => line.includes('Double authentification réinitialisée')))

  // The emailed reset link sets a new password that signs in.
  const finalPassword = randomBytes(18).toString('hex')
  await payload.resetPassword({
    collection: 'users',
    data: { token: emailedResetToken, password: finalPassword },
    overrideAccess: true,
  })
  assert.ok(
    (
      await payload.login({
        collection: 'users',
        data: { email: invitee.email, password: finalPassword },
      })
    ).token,
  )
  assert.ok(((await userByEmail(invitee.email)).sessions?.length ?? 0) > 0)

  // SSH last resort (both devices lost): the CLI password reset also clears the secret.
  await payload.update({
    collection: 'users',
    id: invitee.id,
    overrideAccess: true,
    data: { totpSecret: 'JBSWY3DPEHPK3PXP' },
  })
  await resetAdminPassword(payload, invitee.email, randomBytes(18).toString('hex'))
  assert.equal(await secretOf(invitee.id), null)

  for (const token of tokens)
    assert.ok(
      !logged.some((line) => line.includes(token)),
      'Ni le lien ni le jeton dans les journaux',
    )
  assert.ok(logged.some((line) => line.includes('Invitation administrateur créée')))
  console.log(
    'Vérifications réussies : invitation par lien (simulé) et par email (SMTP), 24 h, usage unique, expiration, échec d’envoi, accès admin, réinitialisation TOTP croisée avec nouveau lien de mot de passe, aucun jeton journalisé.',
  )
} finally {
  await payload.destroy()
}
