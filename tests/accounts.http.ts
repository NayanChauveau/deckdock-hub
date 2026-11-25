// Sign-in by magic link against the production build served by `next start` (tests/run.mjs).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { z } from 'zod'
import { present } from './support/present'

const origin = present(process.env['TEST_ORIGIN'])
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Tests HTTP locaux uniquement.')
const mailbox = present(process.env['ACCOUNTS_TEST_MAILBOX'])
const suiteLog = present(process.env['SUITE_LOG'])
const connectionString = present(process.env['DATABASE_URL'])
if (!new URL(connectionString).pathname.endsWith('_test'))
  throw new Error('Base isolée _test requise.')

const mailSchema = z.object({
  to: z.string(),
  locale: z.string(),
  subject: z.string(),
  text: z.string(),
  url: z.string(),
})
// The production limiter keys on the client address: each case has its own (TEST-NET-2).
let lastAddress = 0
const address = () => `198.51.100.${String(++lastAddress)}`
const unique = (name: string) => `${name}-${String(Date.now())}-${String(lastAddress)}@example.test`
const tokens: string[] = []

function signInRequest(body: unknown, ip = address()) {
  return fetch(`${origin}/api/auth/sign-in/magic-link`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', 'x-real-ip': ip },
    body: JSON.stringify(body),
  })
}
async function lastMail(to: string) {
  const lines = (await readFile(mailbox, 'utf8')).split('\n').filter(Boolean)
  const mails = lines.map((line) => mailSchema.parse(JSON.parse(line) as unknown))
  const mail = present(mails.filter((entry) => entry.to === to).at(-1))
  const token = present(new URL(mail.url).searchParams.get('token'))
  tokens.push(token)
  return { ...mail, token }
}
function open(url: string, cookie?: string) {
  return fetch(url, {
    redirect: 'manual',
    headers: { 'x-real-ip': address(), ...(cookie ? { Cookie: cookie } : {}) },
  })
}
/** `name=value` of the visitor's session cookie set by a response, if any. */
function sessionCookie(response: Response) {
  const cookie = response.headers
    .getSetCookie()
    .find((line) => line.startsWith('customer.session_token=') && !/Max-Age=0/i.test(line))
  return cookie?.split(';')[0]
}
async function sessionEmail(cookie: string) {
  const response = await fetch(`${origin}/api/auth/get-session`, {
    headers: { Cookie: cookie, 'x-real-ip': address() },
  })
  assert.equal(response.status, 200)
  const body: unknown = await response.json()
  return z
    .object({ user: z.object({ email: z.string() }) })
    .nullable()
    .parse(body)?.user.email
}

const client = new pg.Client({ connectionString })
await client.connect()
/** The administration's "Site en maintenance" box (tests/run.mjs unticks it before the server). */
async function maintenance(on: boolean) {
  const updated = await client.query('UPDATE site_settings SET maintenance = $1', [on])
  assert.equal(updated.rowCount, 1)
}
try {
  // magic link signs in and lands on /fr/compte (and /en/compte in English)
  for (const [locale, subject] of [
    ['fr', /connexion/i],
    ['en', /sign-in/i],
  ] as const) {
    const email = unique(`visitor-${locale}`)
    const requested = await signInRequest({ email, callbackURL: `/${locale}/compte` })
    assert.equal(requested.status, 200)
    assert.match(present(requested.headers.get('cache-control')), /no-store/)
    const mail = await lastMail(email)
    assert.equal(mail.locale, locale)
    assert.match(mail.subject, subject)
    assert.ok(mail.text.includes(mail.url))
    const link = new URL(mail.url)
    assert.equal(link.origin, origin)
    assert.equal(link.pathname, '/api/auth/magic-link/verify')
    assert.equal(link.searchParams.get('errorCallbackURL'), `/${locale}/compte/connexion`)
    const opened = await open(mail.url)
    assert.equal(opened.status, 302)
    assert.equal(
      new URL(present(opened.headers.get('location')), origin).pathname,
      `/${locale}/compte`,
    )
    assert.match(present(opened.headers.get('cache-control')), /no-store/)
    const cookie = present(sessionCookie(opened))
    assert.equal(await sessionEmail(cookie), email)
    // The same session is the visitor's `customers` account in Payload.
    const me = await fetch(`${origin}/api/customers/me`, {
      headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' },
    })
    const body: unknown = await me.json()
    assert.equal(z.object({ user: z.object({ email: z.string() }) }).parse(body).user.email, email)
  }

  // account deletion asks for an email confirmation, then deletes and lands on compte/supprime
  for (const [locale, subject] of [
    ['fr', /suppression/i],
    ['en', /delet/i],
  ] as const) {
    const email = unique(`leaving-${locale}`)
    await signInRequest({ email, callbackURL: `/${locale}/compte` })
    const cookie = present(sessionCookie(await open((await lastMail(email)).url)))
    const asked = await fetch(`${origin}/api/auth/delete-user`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookie,
        'Content-Type': 'application/json',
        'x-real-ip': address(),
      },
      // The page of the request gives the language; the link always ends on compte/supprime.
      body: JSON.stringify({ callbackURL: `/${locale}/compte` }),
    })
    assert.equal(asked.status, 200)
    assert.match(present(asked.headers.get('cache-control')), /no-store/)
    assert.equal(await sessionEmail(cookie), email, 'nothing is deleted before the link')
    const mail = await lastMail(email)
    assert.equal(mail.locale, locale)
    assert.match(mail.subject, subject)
    assert.match(mail.text, /24/)
    assert.ok(mail.text.includes(mail.url))
    const link = new URL(mail.url)
    assert.equal(link.origin, origin)
    assert.equal(link.pathname, '/api/auth/delete-user/callback')
    assert.equal(link.searchParams.get('callbackURL'), `/${locale}/compte/supprime`)
    // Without the visitor's session the link deletes nothing, and says so on a page, not in JSON.
    const elsewhere = await open(mail.url)
    assert.equal(elsewhere.status, 302)
    assert.equal(
      present(elsewhere.headers.get('location')),
      `/${locale}/compte?error=deletion_link`,
    )
    assert.match(present(elsewhere.headers.get('cache-control')), /no-store/)
    assert.equal(await sessionEmail(cookie), email)
    const explained = await open(new URL(`/${locale}/compte?error=deletion_link`, origin).href)
    assert.equal(
      present(explained.headers.get('location')),
      `/${locale}/compte/connexion?error=deletion_link`,
      'not signed in here: the sign-in page explains the link',
    )
    const confirmed = await open(mail.url, cookie)
    assert.equal(confirmed.status, 302)
    assert.equal(
      new URL(present(confirmed.headers.get('location')), origin).pathname,
      `/${locale}/compte/supprime`,
    )
    assert.match(present(confirmed.headers.get('cache-control')), /no-store/)
    assert.equal(await sessionEmail(cookie), undefined)
    // The same link again (used up, the visitor still holding the old cookie): a page again.
    const again = await open(mail.url, cookie)
    assert.equal(again.status, 302)
    assert.equal(present(again.headers.get('location')), `/${locale}/compte?error=deletion_link`)
    const me = await fetch(`${origin}/api/customers/me`, {
      headers: { Cookie: cookie, 'Sec-Fetch-Site': 'same-origin' },
    })
    z.object({ user: z.null() }).parse(await me.json())
    const left = await client.query(
      `SELECT 1 FROM auth."user" WHERE email = $1
       UNION ALL SELECT 1 FROM customers WHERE email = $1`,
      [email],
    )
    assert.equal(left.rowCount, 0, 'nothing is left of the account')
  }

  // my account needs a session; the sign-in page sends a signed-in visitor to their account
  {
    const page = await open(`${origin}/fr/compte`)
    assert.equal(page.status, 307)
    assert.equal(present(page.headers.get('location')), '/fr/compte/connexion')
    const signIn = await open(`${origin}/en/compte/connexion?error=INVALID_TOKEN`)
    assert.equal(signIn.status, 200)
    const html = await signIn.text()
    assert.match(html, /This sign-in link no longer works/)
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/)
    const email = unique('pages')
    await signInRequest({ email, callbackURL: '/en/compte' })
    const cookie = present(sessionCookie(await open((await lastMail(email)).url)))
    const signedIn = await open(`${origin}/en/compte/connexion`, cookie)
    assert.equal(signedIn.status, 307)
    assert.equal(present(signedIn.headers.get('location')), '/en/compte')
    const account = await open(`${origin}/en/compte`, cookie)
    assert.equal(account.status, 200)
    assert.ok((await account.text()).includes(email))
  }

  // a used or expired link opens no session
  {
    const email = unique('twice')
    assert.equal((await signInRequest({ email, callbackURL: '/fr/compte' })).status, 200)
    const mail = await lastMail(email)
    const first = await open(mail.url)
    assert.ok(sessionCookie(first))
    const again = await open(mail.url)
    assert.equal(again.status, 302)
    const target = new URL(present(again.headers.get('location')), origin)
    assert.equal(target.pathname, '/fr/compte/connexion')
    assert.equal(target.searchParams.get('error'), 'INVALID_TOKEN')
    assert.equal(sessionCookie(again), undefined)

    const late = unique('late')
    assert.equal((await signInRequest({ email: late, callbackURL: '/en/compte' })).status, 200)
    const expiring = await lastMail(late)
    // Stored hashed (Better Auth's SHA-256, base64url): a database read gives no usable link.
    const plain = await client.query('SELECT 1 FROM auth.verification WHERE identifier LIKE $1', [
      `%${expiring.token}%`,
    ])
    assert.equal(plain.rowCount, 0, 'the sign-in token is not stored in clear')
    const hashed = createHash('sha256').update(expiring.token).digest('base64url')
    const updated = await client.query(
      `UPDATE auth.verification SET "expiresAt" = now() - interval '1 second'
       WHERE identifier = $1`,
      [`magic-link:${hashed}`],
    )
    assert.equal(updated.rowCount, 1)
    const expired = await open(expiring.url)
    assert.equal(expired.status, 302)
    const expiredTarget = new URL(present(expired.headers.get('location')), origin)
    assert.equal(expiredTarget.pathname, '/en/compte/connexion')
    assert.equal(expiredTarget.searchParams.get('error'), 'INVALID_TOKEN')
    assert.equal(sessionCookie(expired), undefined)
    const users = await client.query('SELECT 1 FROM auth."user" WHERE email = $1', [late])
    assert.equal(users.rowCount, 0, 'an expired link creates no account')
  }

  // sign-in request answers the same for known and unknown emails
  {
    const known = unique('known')
    await signInRequest({ email: known, callbackURL: '/fr/compte' })
    assert.ok(sessionCookie(await open((await lastMail(known)).url)), 'known account created')
    const answers = []
    for (const email of [known, unique('unknown')]) {
      const response = await signInRequest({ email, callbackURL: '/fr/compte' })
      answers.push({ status: response.status, body: await response.text() })
      await lastMail(email)
    }
    assert.deepEqual(answers[0], answers[1])
    assert.equal(answers[0]?.status, 200)
  }

  // the handler keeps the starter's body limit
  {
    const response = await signInRequest({ email: unique('big'), name: 'x'.repeat(5000) })
    assert.equal(response.status, 413)
    assert.match(present(response.headers.get('cache-control')), /no-store/)
  }

  // during maintenance /api/auth shows maintenance; a link opened then is not used up
  {
    const email = unique('maintenance')
    assert.equal((await signInRequest({ email, callbackURL: '/en/compte' })).status, 200)
    const mail = await lastMail(email)
    const mailCount = async () =>
      (await readFile(mailbox, 'utf8')).split('\n').filter(Boolean).length
    await maintenance(true)
    try {
      const before = await mailCount()
      const refused = await signInRequest({ email: unique('closed'), callbackURL: '/fr/compte' })
      assert.equal(refused.status, 503)
      assert.ok(refused.headers.get('retry-after'))
      assert.match(present(refused.headers.get('cache-control')), /no-store/)
      assert.equal(await mailCount(), before, 'no email during maintenance')
      const opened = await open(mail.url)
      assert.equal(opened.status, 302)
      assert.equal(new URL(present(opened.headers.get('location')), origin).pathname, '/en/compte')
      assert.match(present(opened.headers.get('cache-control')), /no-store/)
      assert.equal(sessionCookie(opened), undefined)
      // The account pages show maintenance, with neutral metadata, signed in or not.
      for (const path of ['/fr/compte/connexion', '/en/compte', '/en/compte/supprime']) {
        const page = await open(`${origin}${path}`)
        assert.equal(page.status, 200, path)
        const html = await page.text()
        assert.match(html, /Le site ouvre très bientôt\.|The website opens very soon\./, path)
        assert.doesNotMatch(html, /Connexion \||My account|Account deleted/, path)
      }
    } finally {
      await maintenance(false)
    }
    const reopened = await open(mail.url)
    assert.equal(reopened.status, 302)
    assert.equal(new URL(present(reopened.headers.get('location')), origin).pathname, '/en/compte')
    assert.equal(await sessionEmail(present(sessionCookie(reopened))), email)
  }

  // a sign-in request is JSON only: a form-encoded one (which the field filter would not read)
  // is refused before Better Auth, and sends nothing
  {
    const email = unique('form')
    const before = (await readFile(mailbox, 'utf8')).split('\n').filter(Boolean).length
    for (const [type, body] of [
      ['application/x-www-form-urlencoded', new URLSearchParams({ email, name: 'Mallory' })],
      ['text/plain', JSON.stringify({ email, name: 'Mallory' })],
    ] as const) {
      const response = await fetch(`${origin}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': type, 'x-real-ip': address() },
        body: body.toString(),
      })
      assert.equal(response.status, 415, type)
      assert.match(present(response.headers.get('cache-control')), /no-store/)
    }
    const after = (await readFile(mailbox, 'utf8')).split('\n').filter(Boolean).length
    assert.equal(after, before, 'no email for a non-JSON request')
    const charset = await fetch(`${origin}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json; charset=utf-8',
        'x-real-ip': address(),
      },
      body: JSON.stringify({ email, callbackURL: '/fr/compte' }),
    })
    assert.equal(charset.status, 200, 'JSON with a charset is accepted')
  }

  // a sign-in request cannot name the account of the address it targets
  {
    const email = unique('named')
    const requested = await signInRequest({ email, callbackURL: '/fr/compte', name: 'Mallory' })
    assert.equal(requested.status, 200)
    assert.ok(sessionCookie(await open((await lastMail(email)).url)))
    const named = await client.query<{ name: string }>(
      'SELECT name FROM auth."user" WHERE email = $1',
      [email],
    )
    assert.equal(named.rows[0]?.name, '')
  }

  // a burst of magic link requests from one address gets 429 in production
  {
    const ip = address()
    const statuses = []
    for (let attempt = 0; attempt < 6; attempt++)
      statuses.push(
        (await signInRequest({ email: unique('burst'), callbackURL: '/fr' }, ip)).status,
      )
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429])
    // Another address is not affected.
    assert.equal((await signInRequest({ email: unique('other'), callbackURL: '/fr' })).status, 200)
  }

  // simulated mode logs no link: no token reached the server output
  {
    const output = await readFile(suiteLog, 'utf8')
    assert.ok(tokens.length >= 6)
    for (const token of tokens) assert.ok(!output.includes(token), 'a sign-in token was logged')
    assert.ok(!output.includes('/magic-link/verify?'), 'a sign-in link was logged')
    assert.ok(!output.includes('/delete-user/callback?'), 'a deletion link was logged')
  }
  console.log(
    'Comptes HTTP : lien magique, lien usagé ou expiré, réponse uniforme, limite, suppression.',
  )
} finally {
  await client.end()
}
