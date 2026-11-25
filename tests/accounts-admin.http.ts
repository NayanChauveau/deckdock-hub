// A signed-in visitor who opens /admin ends on /admin/unauthorized: never on a second factor page,
// never in a redirect loop. Run twice by tests/run.mjs: payload-totp active (production build,
// ADMIN_TOTP=active) and bypassed (the local administrator's next dev, ADMIN_TOTP=bypassed).
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { messages } from '../src/core/i18n/messages'
import { passwordLogin, setCookie } from './support/admin-session'
import { present } from './support/present'
import { newTotpSecret, totpCode } from './support/totp'

const origin = present(process.env['TEST_ORIGIN'])
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Tests HTTP locaux uniquement.')
const mailbox = present(process.env['ACCOUNTS_TEST_MAILBOX'])
const mode = z.enum(['active', 'bypassed']).parse(process.env['ADMIN_TOTP'])

// Its own client addresses (TEST-NET-3): the production limiter keys on them.
let lastAddress = 0
const headers = (cookie?: string) => ({
  'x-real-ip': `203.0.113.${String(++lastAddress)}`,
  // As a browser sends it with its cookies: the visitor strategy ignores cross-site requests.
  ...(cookie ? { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' } : {}),
})
const mailSchema = z.object({ to: z.string(), url: z.string() })

async function signIn(email: string) {
  const requested = await fetch(`${origin}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { ...headers(), Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, callbackURL: '/fr/compte' }),
  })
  assert.equal(requested.status, 200, 'magic link requested (site open to visitors)')
  const mails = (await readFile(mailbox, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => mailSchema.parse(JSON.parse(line) as unknown))
  const mail = present(mails.filter((entry) => entry.to === email).at(-1))
  const opened = await fetch(mail.url, { redirect: 'manual', headers: headers() })
  assert.equal(opened.status, 302)
  const cookie = opened.headers
    .getSetCookie()
    .find((line) => line.startsWith('customer.session_token=') && !/Max-Age=0/i.test(line))
  return present(cookie?.split(';')[0])
}

/**
 * Follows the redirects of a page by hand: HTTP ones, and those of a page whose streaming had begun,
 * which Next.js sends in the page's React payload (`NEXT_REDIRECT` digest, followed by the browser)
 * or as `<meta id="__next-page-redirect">`. Fails on a loop or after too many hops.
 */
async function visit(path: string, cookie?: string) {
  const visited = [path]
  for (;;) {
    const response = await fetch(`${origin}${path}`, {
      redirect: 'manual',
      headers: headers(cookie),
    })
    const html = response.status === 200 ? await response.text() : ''
    const streamed =
      /NEXT_REDIRECT;(?:replace|push);([^;"\\]+);\d{3};/.exec(html)?.[1] ??
      /<meta id="__next-page-redirect" http-equiv="refresh" content="\d+;url=([^"]+)"/
        .exec(html)?.[1]
        ?.replaceAll('&amp;', '&')
    const location = response.headers.get('location') ?? streamed ?? null
    if (!location) return { status: response.status, html, visited }
    const next = new URL(location, origin)
    assert.equal(next.origin, origin, `redirect off site: ${location}`)
    path = `${next.pathname}${next.search}`
    assert.ok(!visited.includes(path), `redirect loop: ${[...visited, path].join(' → ')}`)
    visited.push(path)
    assert.ok(visited.length <= 5, `too many redirects: ${visited.join(' → ')}`)
  }
}

// The second factor is what this run says: its endpoints exist only while payload-totp is on.
const verify = await fetch(`${origin}/api/verify-totp`, {
  method: 'POST',
  headers: { ...headers(), Origin: origin, 'Content-Type': 'application/json' },
  body: '{}',
})
assert.equal(verify.status === 404, mode === 'bypassed', `payload-totp ${mode}`)

// Nobody signed in: Payload's login page (or first account page, no administrator here), as before.
{
  const { status, visited } = await visit('/admin')
  assert.equal(status, 200)
  assert.match(present(visited.at(-1)), /^\/admin\/(login|create-first-user)/)
}

// A visitor: /admin/unauthorized, with a way back to the site instead of a logout that cannot end
// its session; the visitor stays signed in.
{
  const cookie = await signIn(`admin-visitor-${mode}-${String(Date.now())}@example.test`)
  // The enrolment page exists only while payload-totp is on.
  const starts = [
    '/admin',
    '/admin/collections/users',
    ...(mode === 'active' ? ['/admin/setup-totp'] : []),
  ]
  for (const start of starts) {
    const { status, html, visited } = await visit(start, cookie)
    assert.equal(status, 200, visited.join(' → '))
    assert.equal(visited.at(-1), '/admin/unauthorized', visited.join(' → '))
    assert.ok(!visited.slice(1).some((path) => /totp|login/.test(path)), visited.join(' → '))
    const route = visited.join(' → ')
    assert.ok(
      !html.includes('href="/admin/logout"'),
      `Payload's logout shown to a visitor: ${route}`,
    )
    // The page's own button (Payload's classes) leads to the site.
    assert.match(html, /class="[^"]*\bunauthorized__button\b[^"]*" href="\/"/, route)
    assert.ok(/Retour au site|Back to the website/.test(html), `no way back to the site: ${route}`)
  }
  // GraphQL is off: a visitor session gets nothing from it either.
  const graphql = await fetch(`${origin}/api/graphql`, {
    method: 'POST',
    headers: { ...headers(cookie), Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ Customers { docs { id email } } }' }),
  })
  const graphqlText = await graphql.text()
  assert.ok(!graphqlText.includes('admin-visitor-'), 'GraphQL returns no customer')
  assert.ok(graphql.status >= 400 || graphqlText.includes('"errors"'), 'GraphQL refused')
  const session = await fetch(`${origin}/api/auth/get-session`, { headers: headers(cookie) })
  const body = z
    .object({ user: z.object({ email: z.string() }) })
    .nullable()
    .parse(await session.json())
  assert.ok(body?.user.email.startsWith('admin-visitor-'))
}

// An administrator who is also signed in as a visitor (both cookies) is the administrator: the
// second factor pages, the administration and the site behind maintenance, never unauthorized.
{
  const visitorCookie = await signIn(`admin-both-${mode}-${String(Date.now())}@example.test`)
  const email = `admin-both-${mode}-${String(Date.now())}@example.test`
  const password = randomBytes(18).toString('hex')
  // No administrator exists on this site yet (the anonymous /admin above offered the first one).
  const registered = await fetch(`${origin}/api/users/first-register`, {
    method: 'POST',
    headers: { ...headers(), Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Administrateur', role: 'admin' }),
  })
  assert.equal(registered.status, 200, 'first administrator')
  const json = (cookie: string) => ({
    ...headers(cookie),
    Origin: origin,
    'Content-Type': 'application/json',
  })
  const ends = async (path: string, cookie: string, expected: string) => {
    const { status, visited } = await visit(path, cookie)
    assert.equal(status, 200, visited.join(' → '))
    assert.equal(visited.at(-1)?.split('?')[0], expected, visited.join(' → '))
    assert.ok(!visited.includes('/admin/unauthorized'), visited.join(' → '))
  }
  const site = async (cookie: string) => (await visit('/fr', cookie)).html
  const hidden = (html: string) => html.includes(messages.fr.maintenanceTitle)

  let admin = `${await passwordLogin(origin, email, password)}; ${visitorCookie}`
  // With the second factor on, a password session that has not entered its code yet.
  let passwordOnly: string | undefined
  if (mode === 'active') {
    // Password only, not enrolled: the enrolment page, and its endpoint takes the code.
    await ends('/admin', admin, '/admin/setup-totp')
    await ends('/admin/setup-totp', admin, '/admin/setup-totp')
    const secret = newTotpSecret()
    const enrolled = await fetch(`${origin}/api/setup-totp`, {
      method: 'POST',
      headers: json(admin),
      body: JSON.stringify({ secret, token: totpCode(secret) }),
    })
    assert.deepEqual(await enrolled.json(), { ok: true }, 'setup-totp with both cookies')
    // A new password session: the verification page, and its endpoint takes the code.
    passwordOnly = `${await passwordLogin(origin, email, password)}; ${visitorCookie}`
    await ends('/admin', passwordOnly, '/admin/verify-totp')
    await ends('/admin/verify-totp', passwordOnly, '/admin/verify-totp')
    const verified = await fetch(`${origin}/api/verify-totp`, {
      method: 'POST',
      headers: json(passwordOnly),
      body: JSON.stringify({ token: totpCode(secret) }),
    })
    assert.deepEqual(await verified.json(), { ok: true }, 'verify-totp with both cookies')
    admin = `${passwordOnly}; payload-totp=${present(setCookie(verified, 'payload-totp'))}`
  }
  await ends('/admin', admin, '/admin')
  const toggle = async (maintenance: boolean) => {
    const response = await fetch(`${origin}/api/globals/site-settings`, {
      method: 'POST',
      headers: json(admin),
      body: JSON.stringify({ maintenance }),
    })
    assert.equal(response.status, 200, `maintenance ${String(maintenance)}`)
  }
  await toggle(true)
  try {
    assert.ok(!hidden(await site(admin)), 'the administrator sees the site behind maintenance')
    if (passwordOnly) assert.ok(hidden(await site(passwordOnly)), 'a password alone is not enough')
    assert.ok(hidden(await site(visitorCookie)), 'the visitor sees the maintenance page')
  } finally {
    await toggle(false)
  }
}

console.log(
  `Visiteur sur /admin : /admin/unauthorized, sans boucle ; administrateur avec les deux cookies reconnu (double authentification ${mode}).`,
)
