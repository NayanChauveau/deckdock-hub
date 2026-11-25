import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { test } from 'node:test'
import type { AuthStrategy } from 'payload'
import { present } from './support/present'
import { resolveAuthSecret } from '../src/modules/accounts/adapters/better-auth/secret'
import {
  authRateLimit,
  sendMagicLinkPlaceholder,
} from '../src/modules/accounts/adapters/better-auth/auth'
import {
  accountEmails,
  renderDeletionEmail,
  renderSignInEmail,
  testMailboxFile,
} from '../src/modules/accounts/adapters/email/account-emails'
import {
  callbackLocale,
  requestSignInLink,
  type AccountEmails,
  type AccountLinkMessage,
} from '../src/modules/accounts/application/sign-in-link'
import {
  ORPHAN_MIN_AGE_MS,
  deleteAccount,
  requestDeletionLink,
  sweepOrphanCustomers,
  visitorDeletion,
  type AccountRecords,
  type DeletionReport,
} from '../src/modules/accounts/application/delete-account'
import { betterAuthStrategy } from '../src/modules/accounts/adapters/payload/strategy'
import { authBaseURL } from '../src/modules/accounts/server'
import { failedDeletionLink } from '../src/modules/accounts/adapters/http/deletion-link'
import { devOrigin } from '../src/core/site'

void test('better-auth is pinned to an exact 1.7.x version', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>
  }
  assert.match(manifest.dependencies['better-auth'] ?? '', /^1\.7\.\d+$/)
})

void test('BETTER_AUTH_SECRET: 32 characters at least, required in production only', () => {
  const secret = 'k'.repeat(32)
  assert.equal(resolveAuthSecret({ NODE_ENV: 'production', BETTER_AUTH_SECRET: secret }), secret)
  assert.equal(resolveAuthSecret({ NODE_ENV: 'development', BETTER_AUTH_SECRET: secret }), secret)
  assert.throws(() => resolveAuthSecret({ NODE_ENV: 'production' }), /BETTER_AUTH_SECRET/)
  assert.throws(
    () => resolveAuthSecret({ NODE_ENV: 'production', BETTER_AUTH_SECRET: 'k'.repeat(31) }),
    /BETTER_AUTH_SECRET/,
  )
  assert.throws(
    () => resolveAuthSecret({ NODE_ENV: 'development', BETTER_AUTH_SECRET: 'short' }),
    /BETTER_AUTH_SECRET/,
  )
  assert.equal(resolveAuthSecret({ NODE_ENV: 'development' }), undefined)
  assert.equal(resolveAuthSecret({ NODE_ENV: 'test', BETTER_AUTH_SECRET: '' }), undefined)
})

void test('the placeholder magic link sender refuses and never writes the link', (t) => {
  const written: string[] = []
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
    t.mock.method(console, method, (...args: unknown[]) => void written.push(String(args)))
  assert.throws(() =>
    sendMagicLinkPlaceholder({
      email: 'a@b.test',
      url: 'https://x.test/secret-link',
      token: 't',
    }),
  )
  assert.ok(!written.join('\n').includes('secret-link'))
})

void test('the rate limiter is on in production only, stored in the database', () => {
  assert.deepEqual(authRateLimit({ NODE_ENV: 'production' }), {
    enabled: true,
    storage: 'database',
  })
  for (const NODE_ENV of ['development', 'test', undefined] as const)
    assert.deepEqual(authRateLimit({ NODE_ENV }), { enabled: false, storage: 'database' })
})

const signInSettings = {
  locales: ['fr', 'en'],
  defaultLocale: 'fr',
  signInPath: (locale: string) => `/${locale}/compte/connexion`,
}
const verifyLink = (query: Record<string, string>) => {
  const url = new URL('http://127.0.0.1:3201/api/auth/magic-link/verify')
  for (const [key, value] of Object.entries({ token: 'secret-token', ...query }))
    url.searchParams.set(key, value)
  return url.toString()
}

void test('the email language follows the callback URL, the site default otherwise', () => {
  assert.equal(callbackLocale('/en/compte', signInSettings), 'en')
  assert.equal(callbackLocale('http://127.0.0.1:3201/fr/compte', signInSettings), 'fr')
  for (const callback of [null, '/', '/de/compte', 'not a url ::', '/english'])
    assert.equal(callbackLocale(callback, signInSettings), 'fr', String(callback))
})

void test('a sign-in link sends one email whose used or expired link lands on sign-in', async () => {
  const sent: AccountLinkMessage[] = []
  const emails: AccountEmails = {
    sendSignInLink: async (message) => void sent.push(message),
    sendDeletionLink: () => Promise.reject(new Error('not this email')),
  }
  await requestSignInLink(
    { email: 'a@b.test', url: verifyLink({ callbackURL: '/en/compte' }) },
    emails,
    signInSettings,
  )
  assert.equal(sent.length, 1)
  const message = present(sent[0])
  assert.equal(message.to, 'a@b.test')
  assert.equal(message.locale, 'en')
  const link = new URL(message.url)
  assert.equal(link.searchParams.get('token'), 'secret-token')
  assert.equal(link.searchParams.get('callbackURL'), '/en/compte')
  assert.equal(link.searchParams.get('errorCallbackURL'), '/en/compte/connexion')
  // A caller's own error page is kept (Better Auth checks its origin when the link is opened).
  await requestSignInLink(
    { email: 'a@b.test', url: verifyLink({ callbackURL: '/', errorCallbackURL: '/fr/x' }) },
    emails,
    signInSettings,
  )
  const second = present(sent[1])
  assert.equal(second.locale, 'fr')
  assert.equal(new URL(second.url).searchParams.get('errorCallbackURL'), '/fr/x')
})

void test('the sign-in email is written in the visitor language with the link', () => {
  const url = verifyLink({ callbackURL: '/fr/compte' })
  const fr = renderSignInEmail({ to: 'a@b.test', locale: 'fr', url }, 'Mon site')
  assert.match(fr.subject, /Mon site/)
  assert.match(fr.text, /15 minutes/)
  assert.ok(fr.text.includes(url))
  assert.ok(fr.html.includes(url.replace(/&/g, '&amp;')))
  assert.match(fr.html, /<html lang="fr">/)
  const en = renderSignInEmail({ to: 'a@b.test', locale: 'en', url }, 'Mon site')
  assert.notEqual(en.subject, fr.subject)
  assert.match(en.text, /15 minutes/)
  assert.match(en.html, /<html lang="en">/)
  // Any other language falls back to French, the starter's first language.
  assert.equal(renderSignInEmail({ to: 'a', locale: 'de', url }, 'Mon site').subject, fr.subject)
})

const deletionSettings = {
  locales: ['fr', 'en'],
  defaultLocale: 'fr',
  deletedPath: (locale: string) => `/${locale}/compte/supprime`,
}
const deletionLink = (callbackURL: string) =>
  `http://127.0.0.1:3201/api/auth/delete-user/callback?token=secret-token&callbackURL=${encodeURIComponent(callbackURL)}`

void test('a deletion request sends one email whose link ends on compte/supprime', async () => {
  const sent: AccountLinkMessage[] = []
  const emails: AccountEmails = {
    sendSignInLink: () => Promise.reject(new Error('not this email')),
    sendDeletionLink: async (message) => void sent.push(message),
  }
  for (const [callback, locale] of [
    ['/en/compte', 'en'],
    ['/fr/compte/supprime', 'fr'],
    ['/', 'fr'],
    ['https://attacker.test/en/x', 'en'],
  ] as const) {
    await requestDeletionLink(
      { email: 'a@b.test', url: deletionLink(callback) },
      emails,
      deletionSettings,
    )
    const message = present(sent.at(-1))
    assert.equal(message.to, 'a@b.test')
    assert.equal(message.locale, locale, callback)
    const link = new URL(message.url)
    assert.equal(link.pathname, '/api/auth/delete-user/callback')
    assert.equal(link.searchParams.get('token'), 'secret-token')
    // Whatever the page asked for, the link lands on the site's own deleted page.
    assert.equal(link.searchParams.get('callbackURL'), `/${locale}/compte/supprime`, callback)
  }
  assert.equal(sent.length, 4)
})

void test('the deletion email is written in the visitor language with the link', () => {
  const url = deletionLink('/fr/compte/supprime')
  const fr = renderDeletionEmail({ to: 'a@b.test', locale: 'fr', url }, 'Mon site')
  assert.match(fr.subject, /Mon site/)
  assert.match(fr.text, /24 heures/)
  assert.ok(fr.text.includes(url))
  assert.ok(fr.html.includes(url.replace(/&/g, '&amp;')))
  assert.match(fr.html, /<html lang="fr">/)
  const en = renderDeletionEmail({ to: 'a@b.test', locale: 'en', url }, 'Mon site')
  assert.notEqual(en.subject, fr.subject)
  assert.match(en.text, /24 hours/)
  assert.match(en.html, /<html lang="en">/)
  assert.notEqual(fr.subject, renderSignInEmail({ to: 'a', locale: 'fr', url }, 'Mon site').subject)
})

/** In-memory records: who is left on each side, when each customer was created, and the calls. */
function memoryRecords(authUsers: Set<string>, customers: Map<string, Date>) {
  const calls: string[] = []
  // Document ids in creation order, as Payload's serial ids.
  const ids = new Map([...customers.keys()].map((id, index) => [id, index + 1]))
  const pages: number[] = []
  const records: AccountRecords = {
    removeAuthUser: async (id) => {
      calls.push(`auth:${id}`)
      authUsers.delete(id)
    },
    removeCustomer: async (id) => {
      calls.push(`customer:${id}`)
      customers.delete(id)
    },
    customersCreatedBefore: async (cutoff, { after, limit }) => {
      pages.push(limit)
      return [...customers]
        .filter(([, createdAt]) => createdAt < cutoff)
        .map(([authUserId]) => ({ id: present(ids.get(authUserId)), authUserId }))
        .filter(({ id }) => after === null || id > after)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit)
    },
    existingAuthUsers: async (wanted) => new Set(wanted.filter((id) => authUsers.has(id))),
  }
  return { records, calls, pages }
}
const now = new Date('2026-11-25T12:00:00Z')
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000)
const failingOn = (records: AccountRecords, target: string): AccountRecords => ({
  ...records,
  removeCustomer: (id) =>
    id === target ? Promise.reject(new Error('database unavailable')) : records.removeCustomer(id),
})

void test('deleting an account removes the customer, the user, then any recreated customer', async () => {
  const authUsers = new Set(['u1', 'u2'])
  const customers = new Map([
    ['u1', hoursAgo(1)],
    ['u2', hoursAgo(1)],
  ])
  const { records, calls } = memoryRecords(authUsers, customers)
  await deleteAccount('u1', records)
  assert.deepEqual(calls, ['customer:u1', 'auth:u1', 'customer:u1'])
  assert.deepEqual([...authUsers, ...customers.keys()], ['u2', 'u2'])
  // Idempotent: a second run finds nothing and fails on nothing.
  await deleteAccount('u1', records)
  assert.deepEqual([...authUsers, ...customers.keys()], ['u2', 'u2'])
})

void test('a failed visitor deletion names the Better Auth id, never the address, and fails', async () => {
  const reports: Parameters<DeletionReport>[0][] = []
  const { records } = memoryRecords(new Set(['u1']), new Map([['u1', hoursAgo(1)]]))
  const deletion = visitorDeletion(failingOn(records, 'u1'), (event) => void reports.push(event))
  await assert.rejects(deletion.beforeUserDeleted('u1'), /database unavailable/)
  await assert.rejects(deletion.afterUserDeleted('u1'), /database unavailable/)
  assert.deepEqual(
    reports.map((event) => [event.step, event.authUserId]),
    [
      ['before-user-deleted', 'u1'],
      ['after-user-deleted', 'u1'],
    ],
  )
})

void test('the sweep removes old orphans only, and keeps going past a failure', async () => {
  const authUsers = new Set(['valid'])
  const customers = new Map([
    ['valid', hoursAgo(5)],
    ['orphan', hoursAgo(5)],
    ['broken', hoursAgo(5)],
    // A deletion or a sign-in under way: too young to be judged.
    ['fresh', new Date(now.getTime() - 60_000)],
  ])
  const { records } = memoryRecords(authUsers, customers)
  const reports: Parameters<DeletionReport>[0][] = []
  await assert.rejects(
    sweepOrphanCustomers(failingOn(records, 'broken'), (e) => void reports.push(e), now),
    /1 orphan/,
  )
  assert.deepEqual([...customers.keys()].sort(), ['broken', 'fresh', 'valid'])
  assert.equal(reports[0]?.authUserId, 'broken')
  // Idempotent, and finished by the next run.
  assert.deepEqual(await sweepOrphanCustomers(records, () => undefined, now), { removed: 1 })
  assert.deepEqual(await sweepOrphanCustomers(records, () => undefined, now), { removed: 0 })
  assert.deepEqual([...customers.keys()].sort(), ['fresh', 'valid'])
  assert.ok(ORPHAN_MIN_AGE_MS >= 5 * 60_000)
})

void test('the sweep reads the candidates page by page, never all at once', async () => {
  const authUsers = new Set(['v1', 'v2'])
  const customers = new Map(
    ['o1', 'v1', 'o2', 'o3', 'v2', 'o4', 'o5'].map((id) => [id, hoursAgo(5)] as const),
  )
  const { records, pages } = memoryRecords(authUsers, customers)
  assert.deepEqual(await sweepOrphanCustomers(records, () => undefined, now, 2), { removed: 5 })
  assert.deepEqual([...customers.keys()].sort(), ['v1', 'v2'])
  assert.ok(pages.length >= 4 && pages.every((limit) => limit === 2), String(pages))
})

void test('the test mailbox is ignored in production', () => {
  const file = '/tmp/mailbox.jsonl'
  assert.equal(testMailboxFile({ NODE_ENV: 'test', ACCOUNTS_TEST_MAILBOX: file }), file)
  assert.equal(testMailboxFile({ NODE_ENV: 'development', ACCOUNTS_TEST_MAILBOX: file }), file)
  assert.equal(testMailboxFile({ NODE_ENV: 'test' }), undefined)
  assert.equal(testMailboxFile({ NODE_ENV: 'production', ACCOUNTS_TEST_MAILBOX: file }), undefined)
  // Only tests/run.mjs opens it for its own local production server, never on a public address.
  const local = {
    NODE_ENV: 'production',
    ACCOUNTS_TEST_MAILBOX: file,
    ACCOUNTS_TEST_MAILBOX_LOCAL_PRODUCTION: 'true',
  }
  assert.equal(testMailboxFile({ ...local, APP_URL: 'http://127.0.0.1:41234' }), file)
  assert.equal(testMailboxFile({ ...local, APP_URL: 'https://www.example.com' }), undefined)
  assert.equal(testMailboxFile({ ...local, APP_URL: undefined }), undefined)
})

void test('simulated mode logs no link and sends nothing', async (t) => {
  const written: string[] = []
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const)
    t.mock.method(console, method, (...args: unknown[]) => void written.push(String(args)))
  const emails = accountEmails({
    environment: { NODE_ENV: 'production', EMAIL_MODE: 'simulated', SMTP_URL: 'smtp://x.test' },
    log: (line) => void written.push(line),
  })
  const url = verifyLink({ callbackURL: '/fr/compte' })
  await emails.sendSignInLink({ to: 'visitor@b.test', locale: 'fr', url })
  await emails.sendDeletionLink({ to: 'visitor@b.test', locale: 'en', url: deletionLink('/en') })
  assert.ok(written.length > 1, 'a simulated email still leaves a trace')
  assert.ok(!written.join('\n').includes('secret-token'))
  assert.ok(!written.join('\n').includes('visitor@b.test'))
})

void test('the Better Auth bridge imports nothing from the rest of the starter', async () => {
  const allowed = /^(\.{1,2}\/|payload$|better-auth(\/|$)|kysely$|pg$|node:)/
  for (const folder of ['better-auth', 'payload']) {
    const directory = `src/modules/accounts/adapters/${folder}`
    for (const file of await readdir(directory)) {
      const source = readFileSync(`${directory}/${file}`, 'utf8')
      for (const [, specifier] of source.matchAll(/from\s+'([^']+)'/g)) {
        assert.match(present(specifier), allowed, `${directory}/${file}: ${String(specifier)}`)
        if (present(specifier).startsWith('../'))
          assert.match(
            present(specifier),
            /^\.\.\/(better-auth|payload)\//,
            `${file}: ${specifier}`,
          )
      }
    }
  }
})

void test('the visitor strategy defers to a session Payload recognises after it (I1)', async () => {
  const visitorSession = { user: { id: 'auth-1', email: 'visitor@example.test' } }
  const created: unknown[] = []
  const seen: (string | null)[] = []
  const fakePayload = (adminSignedIn: boolean) => {
    const payload = {
      config: { csrf: [] as string[] },
      authStrategies: [] as AuthStrategy[],
      find: () => Promise.resolve({ docs: [] }),
      create: ({ data }: { data: unknown }) => {
        created.push(data)
        return Promise.resolve({ id: 1, ...(data as object) })
      },
    }
    const visitorStrategy = betterAuthStrategy(
      () => ({ api: { getSession: () => Promise.resolve(visitorSession) } }) as never,
    )
    payload.authStrategies = [
      visitorStrategy,
      {
        name: 'local-jwt',
        authenticate: ({ headers }) => {
          seen.push(headers.get('DisableAutologin'))
          return Promise.resolve({
            user: adminSignedIn ? ({ id: 7, collection: 'users' } as never) : null,
          })
        },
      },
    ]
    return { payload, visitorStrategy }
  }
  const run = async (adminSignedIn: boolean) => {
    const { payload, visitorStrategy } = fakePayload(adminSignedIn)
    return visitorStrategy.authenticate({
      headers: new Headers({ cookie: 'customer.session_token=x' }),
      payload: payload as never,
    })
  }
  assert.equal((await run(true)).user, null, 'the administrator session wins')
  assert.equal(created.length, 0, 'no customer created for an administrator')
  assert.equal(present((await run(false)).user).collection, 'customers')
  assert.deepEqual(seen, ['true', 'true'], "Payload's auto-login is never taken for a session")
})

void test("Better Auth's links use the site's origin, the local one in development (M5)", () => {
  assert.equal(
    authBaseURL({ APP_URL: 'https://shop.example', NODE_ENV: 'production' }),
    'https://shop.example',
  )
  // Like Payload's serverURL: never the request's Host header.
  assert.equal(authBaseURL({ NODE_ENV: 'development' }), devOrigin)
  assert.equal(authBaseURL({ NODE_ENV: 'test' }), devOrigin)
  // Production without APP_URL is refused at startup (Payload's configuration); nothing invented.
  assert.equal(authBaseURL({ NODE_ENV: 'production' }), undefined)
})

void test('a deletion link that deleted nothing lands on the account page with its reason (M13)', () => {
  const link = (status: number, setCookie?: string) =>
    failedDeletionLink(
      new Request('https://shop.example/api/auth/delete-user/callback?token=x'),
      new Response('{}', { status, headers: setCookie ? { 'Set-Cookie': setCookie } : {} }),
      '/fr/compte',
    )
  const used = present(link(400, 'customer.session_token=; Max-Age=0; Path=/'))
  assert.equal(used.status, 302)
  assert.equal(used.headers.get('location'), '/fr/compte?error=deletion_link')
  assert.match(present(used.headers.get('cache-control')), /no-store/)
  // Better Auth's cookies are kept (a cleared or refreshed session cookie).
  assert.deepEqual(used.headers.getSetCookie(), ['customer.session_token=; Max-Age=0; Path=/'])
  // The rate limit is not a used or expired link: its own message.
  assert.equal(present(link(429)).headers.get('location'), '/fr/compte?error=too_many')
  assert.equal(link(200), undefined)
  assert.equal(
    failedDeletionLink(
      new Request('https://shop.example/api/auth/get-session'),
      new Response('{}', { status: 401 }),
      '/fr/compte',
    ),
    undefined,
  )
})
