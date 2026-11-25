import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import { getMigrations } from 'better-auth/db/migration'
import { makeSignature } from 'better-auth/crypto'
import { createLocalReq, getPayload, handleEndpoints } from 'payload'
import config from '../src/payload.config'
import { getAuthOptions } from '../src/modules/accounts/adapters/better-auth/auth'
import { accountRecords, closeAuth, getAuth, sweepOrphans } from '../src/modules/accounts/server'
import { deleteAccount } from '../src/modules/accounts/application/delete-account'
import { Customers, accountsModule } from '../src/modules/accounts/module'
import { jobPurgeStatements, taskSlugs } from '../scripts/module-removal.mjs'
import { ensureCustomer } from '../src/modules/accounts/adapters/payload/strategy'
import { deleteCustomer } from '../src/modules/accounts/adapters/payload/Customers'
import * as orphanSweepMigration from '../src/migrations/20261125_152000_accounts_orphan_sweep'
import { sql } from '@payloadcms/db-postgres'
import { present } from './support/present'

// Runs on a database where `payload migrate` applied every migration to an empty schema.
const connectionString = process.env['DATABASE_URL'] || ''
if (!new URL(connectionString).pathname.endsWith('_test'))
  throw new Error('Base isolée _test requise.')
const appURL = present(process.env['APP_URL'])
const client = new pg.Client({ connectionString })
await client.connect()
const payload = await getPayload({ config })

/** A Better Auth user and a session created by the server API, as the visitor's cookie. */
async function visitor() {
  const context = await getAuth().$context
  const email = `visitor-${randomBytes(4).toString('hex')}@example.test`
  const user = await context.internalAdapter.createUser(
    { email, name: '', emailVerified: true },
    { method: 'magic-link' },
  )
  const session = await context.internalAdapter.createSession(user.id)
  const signature = await makeSignature(session.token, context.secret)
  return {
    authUser: user,
    cookie: `${context.authCookies.sessionToken.name}=${session.token}.${signature}`,
  }
}

interface Call {
  cookie?: string
  origin?: string
  site?: string
  method?: string
  body?: unknown
}
/** Payload's REST API in process, exactly as the Next.js route calls it. */
async function api(path: string, call: Call = {}) {
  const headers = new Headers()
  if (call.cookie) headers.set('cookie', call.cookie)
  if (call.origin) headers.set('origin', call.origin)
  if (call.site) headers.set('sec-fetch-site', call.site)
  if (call.body !== undefined) headers.set('content-type', 'application/json')
  const response = await handleEndpoints({
    config,
    request: new Request(`${appURL}/api${path}`, {
      method: call.method ?? 'GET',
      headers,
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    }),
  })
  const json: unknown = await response.json()
  return { status: response.status, json }
}
const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
const meUser = async (collection: string, call: Call) =>
  field((await api(`/${collection}/me`, call)).json, 'user') ?? null
/** Better Auth's own routes in process, as the site's pages call them. */
async function authRoute(path: string, call: Call = {}) {
  const headers = new Headers({ origin: call.origin ?? appURL })
  if (call.cookie) headers.set('cookie', call.cookie)
  if (call.body !== undefined) headers.set('content-type', 'application/json')
  return getAuth().handler(
    new Request(`${appURL}/api/auth${path}`, {
      method: call.method ?? 'GET',
      headers,
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    }),
  )
}
/** The visitor asks to delete their account: Better Auth stores a token and sends the email. */
async function requestDeletion(cookie: string, authUserId: string) {
  const response = await authRoute('/delete-user', {
    cookie,
    method: 'POST',
    body: { callbackURL: '/fr/compte/supprime' },
  })
  assert.equal(response.status, 200)
  const pending = await client.query<{ identifier: string; expiresAt: Date }>(
    `SELECT identifier, "expiresAt" FROM auth.verification
     WHERE value = $1 AND identifier LIKE 'delete-account-%'`,
    [authUserId],
  )
  assert.equal(pending.rowCount, 1, 'one pending deletion token')
  const row = present(pending.rows[0])
  return { token: row.identifier.slice('delete-account-'.length), expiresAt: row.expiresAt }
}
const deletionLink = (token: string) =>
  `/delete-user/callback?token=${token}&callbackURL=${encodeURIComponent('/fr/compte/supprime')}`
/** What is left of a visitor in the `auth` schema. */
async function authRows(authUserId: string) {
  const count = async (table: string, column: string) =>
    Number(
      (
        await client.query<{ count: string }>(
          `SELECT count(*) FROM auth.${table} WHERE "${column}" = $1`,
          [authUserId],
        )
      ).rows[0]?.count,
    )
  return {
    user: await count('"user"', 'id'),
    session: await count('session', 'userId'),
    account: await count('account', 'userId'),
  }
}
/** A visitor with a session, a linked account row and their `customers` document. */
async function signedInVisitor() {
  const signedIn = await visitor()
  const context = await getAuth().$context
  await context.internalAdapter.createAccount({
    userId: signedIn.authUser.id,
    providerId: 'magic-link',
    accountId: signedIn.authUser.id,
  })
  assert.ok(await meUser('customers', { cookie: signedIn.cookie, origin: appURL }))
  assert.deepEqual(await authRows(signedIn.authUser.id), { user: 1, session: 1, account: 1 })
  return signedIn
}
const gone = { user: 0, session: 0, account: 0 }

/**
 * Faults injected in the database itself, so that the real paths fail where production could:
 * `customers` refuses to delete a row, `auth-user` refuses to delete a user, and `after-user` lets
 * the user go but recreates its customer (a request that read the session just before) and then
 * refuses to delete that one. Armed per Better Auth id, in a schema of the test database only.
 */
await client.query(`
  CREATE SCHEMA IF NOT EXISTS test_faults;
  CREATE TABLE IF NOT EXISTS test_faults.armed (
    auth_user_id text NOT NULL, fault text NOT NULL, PRIMARY KEY (auth_user_id, fault));
  CREATE OR REPLACE FUNCTION test_faults.customer_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM test_faults.armed WHERE auth_user_id = OLD.auth_user_id
               AND fault = 'customers') THEN
      RAISE EXCEPTION 'injected customers failure';
    END IF;
    RETURN OLD;
  END $$;
  CREATE OR REPLACE TRIGGER test_faults_customers BEFORE DELETE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION test_faults.customer_deleted();
  CREATE OR REPLACE FUNCTION test_faults.user_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN
    IF EXISTS (SELECT 1 FROM test_faults.armed WHERE auth_user_id = OLD.id
               AND fault = 'auth-user') THEN
      RAISE EXCEPTION 'injected auth user failure';
    END IF;
    IF EXISTS (SELECT 1 FROM test_faults.armed WHERE auth_user_id = OLD.id
               AND fault = 'after-user') THEN
      INSERT INTO public.customers (auth_user_id, email) VALUES (OLD.id, OLD.email);
      INSERT INTO test_faults.armed VALUES (OLD.id, 'customers') ON CONFLICT DO NOTHING;
    END IF;
    RETURN OLD;
  END $$;
  CREATE OR REPLACE TRIGGER test_faults_user BEFORE DELETE ON auth."user"
    FOR EACH ROW EXECUTE FUNCTION test_faults.user_deleted();
`)
const arm = (authUserId: string, fault: 'customers' | 'auth-user' | 'after-user') =>
  client.query('INSERT INTO test_faults.armed VALUES ($1, $2)', [authUserId, fault])
const disarm = (authUserId: string) =>
  client.query('DELETE FROM test_faults.armed WHERE auth_user_id = $1', [authUserId])
const pendingDeletions = async (authUserId: string) =>
  (
    await client.query(
      `SELECT 1 FROM auth.verification WHERE value = $1 AND identifier LIKE 'delete-account-%'`,
      [authUserId],
    )
  ).rowCount
/** Ages a customer as the sweep sees it. */
const backdate = (authUserId: string) =>
  client.query(
    `UPDATE customers SET created_at = now() - interval '1 hour' WHERE auth_user_id = $1`,
    [authUserId],
  )
const customersOf = async (authUserId: string) =>
  (
    await payload.find({
      collection: 'customers',
      where: { authUserId: { equals: authUserId } },
      overrideAccess: true,
      depth: 0,
    })
  ).docs

try {
  // The hand-written migration and Better Auth's own migration engine agree: nothing to do.
  const plan = await getMigrations(getAuthOptions(), { throwOnUnsafe: false })
  assert.deepEqual(plan.toBeCreated, [], 'Tables Better Auth manquantes après migration')
  assert.deepEqual(plan.toBeAdded, [], 'Colonnes Better Auth manquantes après migration')

  // Every table lives in the `auth` schema, none of them in `public`.
  const tables = await client.query<{ table_schema: string; table_name: string }>(
    `SELECT table_schema, table_name FROM information_schema.tables
     WHERE table_name IN ('user', 'session', 'account', 'verification', 'rateLimit')`,
  )
  assert.deepEqual(
    tables.rows.map((row) => `${row.table_schema}.${row.table_name}`).sort(),
    ['account', 'rateLimit', 'session', 'user', 'verification'].map((name) => `auth.${name}`),
  )

  // No foreign key crosses the two schemas (drizzle would propose to drop it).
  const crossing = await client.query(
    `SELECT conname FROM pg_constraint c
     JOIN pg_class a ON a.oid = c.conrelid JOIN pg_namespace an ON an.oid = a.relnamespace
     JOIN pg_class b ON b.oid = c.confrelid JOIN pg_namespace bn ON bn.oid = b.relnamespace
     WHERE c.contype = 'f' AND an.nspname <> bn.nspname`,
  )
  assert.deepEqual(crossing.rows, [])

  // The instance is a lazy singleton with its own settings.
  const auth = getAuth()
  assert.equal(getAuth(), auth)
  assert.equal(auth.options.basePath, '/api/auth')
  assert.equal(auth.options.advanced.cookiePrefix, 'customer')
  assert.equal(auth.options.rateLimit.storage, 'database')
  assert.equal(auth.options.rateLimit.enabled, false, 'limiteur actif en production seulement')
  assert.deepEqual(auth.options.advanced.ipAddress.ipAddressHeaders, ['x-real-ip'])

  // customers me returns the customer for a valid session
  {
    const { authUser, cookie } = await visitor()
    assert.equal(await meUser('customers', { origin: appURL }), null, 'sans session')
    const me = await meUser('customers', { cookie, origin: appURL })
    assert.equal(field(me, 'authUserId'), authUser.id)
    assert.equal(field(me, 'email'), authUser.email)
    assert.equal(field(me, 'collection'), 'customers')
    assert.equal(field(me, '_strategy'), 'better-auth')
    // A browser request of the site itself without Origin (navigation, same-origin GET).
    for (const site of ['same-origin', 'same-site', 'none'])
      assert.equal(field(await meUser('customers', { cookie, site }), 'id'), field(me, 'id'), site)
    assert.equal((await customersOf(authUser.id)).length, 1)
  }

  // Payload requests never extend a session; Better Auth's get-session extends it with the cookie
  {
    const { cookie } = await visitor()
    const token = present(cookie.split('=')[1]?.split('.')[0])
    // Two days old out of seven: past the one-day update age, a refresh is due.
    await client.query(
      `UPDATE auth.session SET "expiresAt" = now() + interval '5 days' WHERE token = $1`,
      [token],
    )
    const expiry = async () =>
      (
        await client.query<{ expiresAt: Date }>(
          'SELECT "expiresAt" FROM auth.session WHERE token = $1',
          [token],
        )
      ).rows[0]?.expiresAt.getTime() ?? 0
    const before = await expiry()
    assert.ok(await meUser('customers', { cookie, origin: appURL }))
    assert.equal(await expiry(), before, 'Payload ne prolonge pas la session')
    const refreshed = await getAuth().handler(
      new Request(`${appURL}/api/auth/get-session`, { headers: { cookie } }),
    )
    assert.equal(refreshed.status, 200)
    assert.ok((await expiry()) > before + 86_400_000, 'get-session prolonge la session')
    assert.ok(
      refreshed.headers.getSetCookie().some((line) => line.startsWith('customer.session_token=')),
      'et renvoie le cookie avec sa nouvelle durée',
    )
  }

  // a request from another origin with the customer cookie is not authenticated
  {
    const { authUser, cookie } = await visitor()
    const customer = present(await meUser('customers', { cookie, origin: appURL }))
    const foreign = 'https://attacker.test'
    // Same rule as Payload's own cookie: an Origin outside `csrf` wins over Sec-Fetch-Site.
    for (const call of [
      { cookie, origin: foreign },
      { cookie, origin: foreign, site: 'same-origin' },
      { cookie, site: 'cross-site' },
      // No Origin and no Sec-Fetch-Site: not a browser of the site, refused like Payload does.
      { cookie },
    ])
      assert.equal(await meUser('customers', call), null, JSON.stringify(call))
    // The same list: the visitor's own document from the site, nothing from another origin.
    const own = await api('/customers', { cookie, origin: appURL })
    assert.deepEqual(
      (field(own.json, 'docs') as unknown[]).map((doc) => field(doc, 'id')),
      [field(customer, 'id')],
    )
    assert.equal((await api('/customers', { cookie, origin: foreign })).status, 403)
    assert.equal((await customersOf(authUser.id)).length, 1)
  }

  // concurrent first requests create exactly one customer
  {
    const { authUser, cookie } = await visitor()
    const users = await Promise.all(
      Array.from({ length: 8 }, () => meUser('customers', { cookie, origin: appURL })),
    )
    const ids = new Set(users.map((user) => field(user, 'id')))
    assert.equal(ids.size, 1, `un seul client attendu : ${JSON.stringify([...ids])}`)
    assert.ok(![...ids].includes(undefined), 'chaque requête est authentifiée')
    assert.equal((await customersOf(authUser.id)).length, 1)

    const direct = await visitor()
    const ensured = await Promise.all(
      Array.from({ length: 8 }, () =>
        ensureCustomer({ id: direct.authUser.id, email: direct.authUser.email }, payload),
      ),
    )
    assert.equal(new Set(ensured.map((customer) => customer.id)).size, 1)
    assert.equal((await customersOf(direct.authUser.id)).length, 1)
  }

  // a customer cannot change authUserId or email
  {
    const { authUser, cookie } = await visitor()
    const customer = present(await meUser('customers', { cookie, origin: appURL }))
    const id = String(field(customer, 'id'))
    const patched = await api(`/customers/${id}`, {
      cookie,
      origin: appURL,
      method: 'PATCH',
      body: { authUserId: 'someone-else', email: 'attacker@example.test' },
    })
    assert.equal(patched.status, 403)
    const created = await api('/customers', {
      cookie,
      origin: appURL,
      method: 'POST',
      body: { authUserId: 'someone-else', email: 'attacker@example.test' },
    })
    assert.equal(created.status, 403)
    const [stored] = await customersOf(authUser.id)
    assert.equal(present(stored).email, authUser.email)
    assert.equal(present(stored).authUserId, authUser.id)
    // Even the administration cannot rewrite them: they belong to Better Auth.
    for (const name of ['authUserId', 'email']) {
      const definition = Customers.fields.find((entry) => 'name' in entry && entry.name === name)
      const update = present(
        definition && 'access' in definition ? definition.access : undefined,
      ).update
      assert.equal(await present(update)({} as never), false, name)
    }
  }

  // a customer cannot read users or another customer
  {
    const first = await visitor()
    const second = await visitor()
    const mine = present(await meUser('customers', { cookie: first.cookie, origin: appURL }))
    const other = present(await meUser('customers', { cookie: second.cookie, origin: appURL }))
    const asFirst = { cookie: first.cookie, origin: appURL }
    assert.equal((await api('/users', asFirst)).status, 403)
    const list = await api('/customers', asFirst)
    assert.equal(list.status, 200)
    const docs = field(list.json, 'docs')
    assert.ok(Array.isArray(docs))
    assert.deepEqual(
      docs.map((doc: unknown) => field(doc, 'id')),
      [field(mine, 'id')],
    )
    assert.equal((await api(`/customers/${String(field(other, 'id'))}`, asFirst)).status, 404)
    const deleted = await api(`/customers/${String(field(mine, 'id'))}`, {
      ...asFirst,
      method: 'DELETE',
    })
    assert.equal(deleted.status, 403, 'un client ne se supprime pas par l’API de Payload')
  }

  // an admin session is not a customer and a customer is not an admin
  {
    const email = `admin-${randomBytes(4).toString('hex')}@example.test`
    const password = randomBytes(24).toString('hex')
    await payload.create({
      collection: 'users',
      data: { email, name: 'Administrateur', role: 'admin', password },
    })
    const { token } = await payload.login({ collection: 'users', data: { email, password } })
    const adminCookie = `payload-token=${present(token)}`
    assert.equal(
      field(await meUser('users', { cookie: adminCookie, origin: appURL }), 'email'),
      email,
    )
    assert.equal(await meUser('customers', { cookie: adminCookie, origin: appURL }), null)

    const { cookie } = await visitor()
    assert.ok(await meUser('customers', { cookie, origin: appURL }))
    assert.equal(await meUser('users', { cookie, origin: appURL }), null)
    // The rules themselves: an administrator reads and deletes, never creates nor edits.
    const admin = { req: { user: { collection: 'users', role: 'admin' } } } as never
    const access = present(Customers.access)
    assert.equal(await present(access.read)(admin), true)
    assert.equal(await present(access.delete)(admin), true)
    assert.equal(await present(access.create)(admin), false)
    assert.equal(await present(access.update)(admin), false)
    assert.equal(await present(access.admin)(admin), false)
    const customer = { req: { user: { collection: 'customers', id: 1, role: 'admin' } } } as never
    assert.equal(await present(access.delete)(customer), false, 'un rôle sur un client est ignoré')

    // An administrator who is also signed in as a visitor (both cookies) stays the administrator:
    // Payload's own session wins, even though the visitor strategy runs before `local-jwt`.
    const both = await visitor()
    const asBoth = { cookie: `${adminCookie}; ${both.cookie}`, origin: appURL }
    assert.equal(field(await meUser('users', asBoth), 'email'), email, 'admin with both cookies')
    assert.equal(await meUser('customers', asBoth), null, 'never the visitor')
    const { user: seen } = await payload.auth({
      headers: new Headers({ cookie: asBoth.cookie, 'sec-fetch-site': 'same-origin' }),
    })
    assert.equal(field(seen, 'collection'), 'users', 'maintenance sees the administrator')
    assert.equal((await customersOf(both.authUser.id)).length, 0, 'no customer created for it')
    // The visitor cookie alone still signs the visitor in.
    assert.ok(await meUser('customers', { cookie: both.cookie, origin: appURL }))
  }
  // a customer gets nothing from Payload's own collections; admin locking still works
  {
    const email = `locker-${randomBytes(4).toString('hex')}@example.test`
    const password = randomBytes(24).toString('hex')
    const admin = await payload.create({
      collection: 'users',
      data: { email, name: 'Administrateur', role: 'admin', password },
    })
    // An administrator whose session entered its code (payload-totp lets it through when on).
    const asAdmin = await createLocalReq(
      {
        user: Object.assign(
          { ...admin, collection: 'users' as const, hasTotp: true },
          { _strategy: 'totp' },
        ),
      },
      payload,
    )
    const { authUser, cookie } = await visitor()
    const asVisitor = { cookie, origin: appURL }
    assert.ok(await meUser('customers', asVisitor))
    const target = present((await customersOf(authUser.id))[0])
    const lock = await payload.create({
      collection: 'payload-locked-documents',
      data: {
        document: { relationTo: 'customers', value: target.id },
        user: { relationTo: 'users', value: admin.id },
      },
      req: asAdmin,
      overrideAccess: false,
    })
    const locks = await payload.find({
      collection: 'payload-locked-documents',
      where: { id: { equals: lock.id } },
      req: asAdmin,
      overrideAccess: false,
    })
    assert.equal(locks.totalDocs, 1, 'un administrateur lit ses verrous')

    const forged = {
      document: { relationTo: 'customers', value: target.id },
      user: { relationTo: 'users', value: admin.id },
    }
    for (const [path, method, body] of [
      ['/payload-locked-documents', 'GET'],
      [`/payload-locked-documents/${String(lock.id)}`, 'GET'],
      ['/payload-locked-documents', 'POST', forged],
      [`/payload-locked-documents/${String(lock.id)}`, 'PATCH', forged],
      [`/payload-locked-documents/${String(lock.id)}`, 'DELETE'],
      ['/payload-preferences', 'GET'],
      ['/payload-preferences', 'POST', { key: 'abuse', value: { big: 'x' } }],
      ['/payload-preferences/abuse', 'GET'],
      ['/payload-preferences/abuse', 'POST', { value: { big: 'x' } }],
      ['/payload-preferences/abuse', 'DELETE'],
      ['/globals/payload-jobs-stats', 'GET'],
      ['/customers/logout', 'POST'],
      ['/customers/refresh-token', 'POST'],
    ] as const) {
      const response = await api(path, { ...asVisitor, method, ...(body ? { body } : {}) })
      assert.equal(response.status, 403, `${method} ${path}`)
    }
    assert.equal(
      (
        await payload.count({
          collection: 'payload-locked-documents',
          where: { id: { equals: lock.id } },
        })
      ).totalDocs,
      1,
      'le verrou de l’administrateur reste',
    )
    assert.equal(
      (
        await payload.count({
          collection: 'payload-preferences',
          where: { 'user.relationTo': { equals: 'customers' } },
        })
      ).totalDocs,
      0,
    )
    // Every access rule of every Payload collection or global answers no to a visitor session.
    const asCustomer = await createLocalReq(
      {
        user: Object.assign(
          { ...target, collection: 'customers' as const },
          { _strategy: 'better-auth' },
        ),
      },
      payload,
    )
    const internal = [...payload.config.collections, ...payload.config.globals].filter((entity) =>
      entity.slug.startsWith('payload-'),
    )
    assert.ok(internal.some((entity) => entity.slug === 'payload-locked-documents'))
    assert.ok(internal.some((entity) => entity.slug === 'payload-preferences'))
    for (const entity of internal)
      for (const [operation, rule] of Object.entries(entity.access)) {
        if (typeof rule !== 'function') continue
        const result: unknown = await Reflect.apply(rule, undefined, [{ req: asCustomer }])
        assert.equal(result, false, `${entity.slug}.${operation}`)
      }
    // The administrator keeps preferences of their own through the same endpoints.
    const { token } = await payload.login({ collection: 'users', data: { email, password } })
    const asAdminCookie = { cookie: `payload-token=${present(token)}`, origin: appURL }
    const saved = await api('/payload-preferences/columns', {
      ...asAdminCookie,
      method: 'POST',
      body: { value: { kept: true } },
    })
    assert.equal(saved.status, 200)
    const read = await api('/payload-preferences/columns', asAdminCookie)
    assert.deepEqual(field(read.json, 'value'), { kept: true })
  }

  // deletion link without confirmation does nothing
  {
    const { authUser, cookie } = await signedInVisitor()
    const other = await signedInVisitor()
    const { token, expiresAt } = await requestDeletion(cookie, authUser.id)
    // Better Auth's default: the confirmation link is valid for 24 hours, as the email says.
    const lifetime = expiresAt.getTime() - Date.now()
    assert.ok(lifetime > 86_400_000 - 120_000 && lifetime <= 86_400_000, String(lifetime))
    // Asking is not deleting: the account and its session stay until the link is opened.
    assert.deepEqual(await authRows(authUser.id), { user: 1, session: 1, account: 1 })
    assert.equal((await customersOf(authUser.id)).length, 1)
    // A direct deletion is refused: the email is the confirmation, a session alone is not enough.
    const direct = await authRoute('/delete-user', { cookie, method: 'POST', body: {} })
    assert.equal(direct.status, 200)
    assert.equal(field(await direct.json(), 'message'), 'Verification email sent')
    assert.deepEqual(await authRows(authUser.id), { user: 1, session: 1, account: 1 })
    // The link opened without the session, with another visitor's session, or a wrong token.
    for (const call of [{}, { cookie: other.cookie }])
      assert.equal((await authRoute(deletionLink(token), call)).status, 404, JSON.stringify(call))
    assert.equal((await authRoute(deletionLink('not-a-token'), { cookie })).status, 404)
    assert.equal((await authRoute('/delete-user', { method: 'POST', body: {} })).status, 401)
    for (const id of [authUser.id, other.authUser.id]) {
      assert.deepEqual(await authRows(id), { user: 1, session: 1, account: 1 })
      assert.equal((await customersOf(id)).length, 1)
    }
    assert.ok(await meUser('customers', { cookie, origin: appURL }))
  }

  // confirmed deletion removes auth user, sessions and customer
  {
    const { authUser, cookie } = await signedInVisitor()
    const { token } = await requestDeletion(cookie, authUser.id)
    const confirmed = await authRoute(deletionLink(token), { cookie })
    assert.equal(confirmed.status, 302)
    assert.equal(confirmed.headers.get('location'), '/fr/compte/supprime')
    assert.ok(
      confirmed.headers
        .getSetCookie()
        .some((line) => line.startsWith('customer.session_token=') && /Max-Age=0/i.test(line)),
      'the session cookie is expired',
    )
    assert.deepEqual(await authRows(authUser.id), gone)
    assert.equal((await customersOf(authUser.id)).length, 0)
    // The old cookie authenticates nothing and recreates nothing.
    assert.equal(await meUser('customers', { cookie, origin: appURL }), null)
    assert.equal((await customersOf(authUser.id)).length, 0)
    // The link works once.
    assert.equal((await authRoute(deletionLink(token), { cookie })).status, 404)
  }

  // admin deletion of a customer removes the auth user
  {
    const email = `remover-${randomBytes(4).toString('hex')}@example.test`
    const admin = await payload.create({
      collection: 'users',
      data: {
        email,
        name: 'Administrateur',
        role: 'admin',
        password: randomBytes(24).toString('hex'),
      },
    })
    // An administrator whose session entered its code, deleting from the administration.
    const asAdmin = await createLocalReq(
      {
        user: Object.assign(
          { ...admin, collection: 'users' as const, hasTotp: true },
          { _strategy: 'totp' },
        ),
      },
      payload,
    )
    const deleteAsAdmin = async (authUserId: string) =>
      payload.delete({
        collection: 'customers',
        id: present((await customersOf(authUserId))[0]).id,
        req: asAdmin,
        overrideAccess: false,
      })
    const { authUser, cookie } = await signedInVisitor()
    // A deletion link the visitor asked for and never opened goes with the account.
    await requestDeletion(cookie, authUser.id)
    await deleteAsAdmin(authUser.id)
    assert.deepEqual(await authRows(authUser.id), gone)
    assert.equal(await pendingDeletions(authUser.id), 0)
    // The visitor's next request is anonymous: the customer is not recreated.
    assert.equal(await meUser('customers', { cookie, origin: appURL }), null)
    assert.equal((await customersOf(authUser.id)).length, 0)

    // Better Auth fails: Payload rolls the deletion back, and the next attempt finishes.
    const kept = await signedInVisitor()
    await arm(kept.authUser.id, 'auth-user')
    await assert.rejects(deleteAsAdmin(kept.authUser.id), /injected auth user failure/)
    assert.equal((await customersOf(kept.authUser.id)).length, 1, 'rolled back')
    assert.deepEqual(await authRows(kept.authUser.id), { user: 1, session: 1, account: 1 })
    await disarm(kept.authUser.id)
    await deleteAsAdmin(kept.authUser.id)
    assert.deepEqual(await authRows(kept.authUser.id), gone)
    assert.equal((await customersOf(kept.authUser.id)).length, 0)

    // An administrator removes a customer whose Better Auth user is already gone.
    const orphan = await signedInVisitor()
    await (await getAuth().$context).internalAdapter.deleteUser(orphan.authUser.id)
    await deleteAsAdmin(orphan.authUser.id)
    assert.equal((await customersOf(orphan.authUser.id)).length, 0)
  }

  // deletion resumes after a partial failure without looping
  {
    // Removing the customer fails before Better Auth deletes anything: the account stays whole,
    // the visitor is still signed in and confirms again from a new link.
    {
      const { authUser, cookie } = await signedInVisitor()
      const { token } = await requestDeletion(cookie, authUser.id)
      await arm(authUser.id, 'customers')
      const failed = await authRoute(deletionLink(token), { cookie })
      assert.equal(failed.status, 500)
      assert.equal(await pendingDeletions(authUser.id), 0, 'the link is used up')
      assert.deepEqual(await authRows(authUser.id), { user: 1, session: 1, account: 1 })
      assert.equal((await customersOf(authUser.id)).length, 1)
      assert.ok(await meUser('customers', { cookie, origin: appURL }), 'still signed in')
      await disarm(authUser.id)
      const again = await requestDeletion(cookie, authUser.id)
      assert.equal((await authRoute(deletionLink(again.token), { cookie })).status, 302)
      assert.deepEqual(await authRows(authUser.id), gone)
      assert.equal((await customersOf(authUser.id)).length, 0)
    }
    // The user goes, a customer recreated meanwhile cannot be removed: an orphan, swept later.
    {
      const { authUser, cookie } = await signedInVisitor()
      const { token } = await requestDeletion(cookie, authUser.id)
      await arm(authUser.id, 'after-user')
      const failed = await authRoute(deletionLink(token), { cookie })
      assert.equal(failed.status, 500)
      assert.deepEqual(await authRows(authUser.id), gone)
      assert.equal((await customersOf(authUser.id)).length, 1, 'an orphan is left')
      assert.equal(await meUser('customers', { cookie, origin: appURL }), null)
      assert.equal((await customersOf(authUser.id)).length, 1, 'and nothing adds to it')
      await disarm(authUser.id)
      // Too recent for the sweep at first; an hour later it goes.
      await sweepOrphans(payload)
      assert.equal((await customersOf(authUser.id)).length, 1)
      await backdate(authUser.id)
      await sweepOrphans(payload)
      assert.equal((await customersOf(authUser.id)).length, 0)
    }
    // The customer went first under the flag: its hook leaves Better Auth alone (no loop).
    {
      const { authUser } = await signedInVisitor()
      await payload.delete({
        collection: 'customers',
        where: { authUserId: { equals: authUser.id } },
        overrideAccess: true,
        context: { accountsDeleting: true },
      })
      assert.deepEqual(await authRows(authUser.id), { user: 1, session: 1, account: 1 })
      await deleteAccount(authUser.id, accountRecords(payload))
      assert.deepEqual(await authRows(authUser.id), gone)
      await deleteAccount(authUser.id, accountRecords(payload))
    }
  }

  // the orphan sweep removes old orphans and leaves fresh or valid customers alone
  {
    const valid = await signedInVisitor()
    await backdate(valid.authUser.id)
    const old = await signedInVisitor()
    await backdate(old.authUser.id)
    await (await getAuth().$context).internalAdapter.deleteUser(old.authUser.id)
    // A customer whose user is not there yet, or no longer: too recent to be judged.
    const fresh = await signedInVisitor()
    await (await getAuth().$context).internalAdapter.deleteUser(fresh.authUser.id)
    await sweepOrphans(payload)
    assert.equal((await customersOf(valid.authUser.id)).length, 1, 'valid kept')
    assert.deepEqual(await authRows(valid.authUser.id), { user: 1, session: 1, account: 1 })
    assert.equal((await customersOf(fresh.authUser.id)).length, 1, 'fresh kept')
    assert.equal((await customersOf(old.authUser.id)).length, 0, 'orphan removed')
    await sweepOrphans(payload)
    assert.equal((await customersOf(valid.authUser.id)).length, 1)
    // The task the module schedules, run by Payload's job runner.
    await backdate(fresh.authUser.id)
    const job = await payload.jobs.queue({
      task: 'accounts-orphan-sweep',
      queue: 'accounts',
      input: {},
    })
    await payload.jobs.runByID({ id: job.id })
    assert.equal((await customersOf(fresh.authUser.id)).length, 0)
    // Done, so Payload removed the job (it keeps only those that failed).
    assert.equal(
      (await payload.count({ collection: 'payload-jobs', where: { id: { equals: job.id } } }))
        .totalDocs,
      0,
    )
  }

  // the hourly sweep also purges expired sign-in links (they hold the address of someone who never
  // opened them) and rate limit rows no window still reads
  {
    // This script runs twice on the same database (payload-totp on, then off).
    const tag = randomBytes(4).toString('hex')
    await client.query(
      `INSERT INTO auth.verification (id, identifier, value, "expiresAt") VALUES
         ($1, 'magic-link:expired', '{"email":"gone@example.test"}', now() - interval '1 minute'),
         ($2, 'magic-link:live', '{"email":"live@example.test"}', now() + interval '10 minutes')`,
      [`expired-${tag}`, `live-${tag}`],
    )
    await client.query(
      `INSERT INTO auth."rateLimit" (id, key, count, "lastRequest") VALUES
         ($1, $1, 3, $3), ($2, $2, 1, $4)`,
      [`old-${tag}`, `recent-${tag}`, Date.now() - 2 * 3_600_000, Date.now() - 60_000],
    )
    await sweepOrphans(payload)
    const left = async (table: string) =>
      (
        await client.query<{ id: string }>(
          `SELECT id FROM auth.${table} WHERE id LIKE $1 ORDER BY id`,
          [`%-${tag}`],
        )
      ).rows.map((row) => row.id)
    assert.deepEqual(await left('verification'), [`live-${tag}`])
    assert.deepEqual(await left('"rateLimit"'), [`recent-${tag}`])
  }

  // an address Better Auth accepts but Payload's email validator would refuse still gets its
  // customer (a domain label ending with a hyphen passes Better Auth's check)
  {
    const unusual = {
      id: `unusual-${randomBytes(4).toString('hex')}`,
      email: 'a@sub-.example.test',
    }
    const customer = await ensureCustomer(unusual, payload)
    assert.equal(customer.email, unusual.email)
    await deleteCustomer(payload, unusual.id)
  }

  // the orphan sweep migration's down() keeps the site's other task slugs (not a fixed list), in
  // order, and only drops its own (rolled back)
  {
    const enumLabels = async (type: string) =>
      (
        await payload.db.drizzle.execute<{ label: string }>(
          sql.raw(
            `SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = '"public"."${type}"'::regtype ORDER BY enumsortorder`,
          ),
        )
      ).rows.map((row) => row.label)
    const before = await enumLabels('enum_payload_jobs_task_slug')
    assert.ok(before.includes('accounts-orphan-sweep'))
    const transaction = present(await payload.db.beginTransaction())
    const session: unknown = Reflect.get(Object(payload.db.sessions), transaction)
    try {
      const db = Reflect.get(Object(present(session)), 'db') as typeof payload.db.drizzle
      await db.execute(
        sql.raw(`ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'site-own-task';
          ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'site-own-task';`),
      )
      await orphanSweepMigration.down({ db, payload, req: {} as never })
      for (const type of ['enum_payload_jobs_task_slug', 'enum_payload_jobs_log_task_slug']) {
        const labels = (
          await db.execute<{ label: string }>(
            sql.raw(
              `SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = '"public"."${type}"'::regtype ORDER BY enumsortorder`,
            ),
          )
        ).rows.map((row) => row.label)
        assert.deepEqual(
          labels,
          [...before.filter((label) => label !== 'accounts-orphan-sweep'), 'site-own-task'],
          type,
        )
      }
    } finally {
      await payload.db.rollbackTransaction(transaction)
    }
    assert.deepEqual(await enumLabels('enum_payload_jobs_task_slug'), before, 'rolled back')
  }

  // Removing the module from a deployed site: the purge the removal guidance prints lets Payload's
  // generated narrowing of the task slug enums pass, with the sweep's next run queued (as in
  // production) and a failed run's log. Without it the cast fails. Rolled back.
  {
    const slugs = taskSlugs([accountsModule])
    assert.deepEqual(slugs, ['accounts-orphan-sweep'])
    /** The statements `payload migrate:create` writes when a task slug leaves the enums. */
    const narrow = async () => {
      for (const table of ['payload_jobs_log', 'payload_jobs']) {
        const type = `"public"."enum_${table}_task_slug"`
        const { rows } = await client.query<{ label: string }>(
          'SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = $1::regtype ORDER BY enumsortorder',
          [type],
        )
        const kept = rows
          .map((row) => row.label)
          .filter((label) => !slugs.includes(label))
          .map((label) => `'${label}'`)
        await client.query(`
          ALTER TABLE "${table}" ALTER COLUMN "task_slug" SET DATA TYPE text;
          DROP TYPE ${type};
          CREATE TYPE ${type} AS ENUM(${kept.join(', ')});
          ALTER TABLE "${table}" ALTER COLUMN "task_slug" SET DATA TYPE ${type} USING "task_slug"::${type};`)
      }
    }
    await client.query('BEGIN')
    try {
      const queued = await client.query<{ id: number }>(
        `INSERT INTO payload_jobs (task_slug, queue, wait_until)
         VALUES ('accounts-orphan-sweep', 'accounts', now() + interval '1 hour'), (NULL, 'accounts', NULL)
         RETURNING id`,
      )
      await client.query(
        `INSERT INTO payload_jobs_log
           (_order, _parent_id, id, executed_at, completed_at, task_slug, task_i_d, state)
         VALUES (1, $1, 'log-1', now(), now(), 'accounts-orphan-sweep', '1', 'failed')`,
        [present(queued.rows[1]).id],
      )
      await client.query('SAVEPOINT unpurged')
      await assert.rejects(narrow(), /invalid input value for enum/, 'the cast fails unpurged')
      await client.query('ROLLBACK TO SAVEPOINT unpurged')
      for (const statement of jobPurgeStatements(slugs)) await client.query(statement)
      await narrow()
    } finally {
      await client.query('ROLLBACK')
    }
  }
  console.log('Comptes : schéma auth migré, clients reliés aux sessions Better Auth, suppression.')
} finally {
  await client.query('DROP SCHEMA IF EXISTS test_faults CASCADE')
  await client.end()
  await closeAuth()
  await payload.destroy()
}
