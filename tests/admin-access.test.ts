import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { NextRequest } from 'next/server'
import type { Config } from 'payload'
import { Users } from '../src/core/payload/collections/Users'
import { Media } from '../src/core/payload/collections/Media'
import { SiteContent } from '../src/site/SiteContent'
import { SiteSettings } from '../src/core/payload/globals/SiteSettings'
import { LegalPages } from '../src/core/payload/globals/LegalPages'
import {
  auditSetupTotp,
  requireStoredSecret,
  totpDisabled,
  totpPlugins,
} from '../src/core/admin/totp'
import { INVITATION_LIFETIME_MS, invitationEmail } from '../src/core/admin/invitations'
import { totpResetEmail } from '../src/core/admin/password-links'
import {
  canSeeThroughMaintenance,
  isAdmin,
  isAdminCollectionUser,
} from '../src/core/payload/access'
import {
  ADMIN_GUARD_PROVIDER,
  PAYLOAD_TOTP_PROVIDER,
  TOTP_GATE_PROVIDER,
  UNAUTHORIZED_VIEW,
  adminGuardRedirect,
  bypassesTotp,
  unauthorizedExit,
} from '../src/core/admin/admin-guard'
import nextConfig from '../next.config.mjs'
import { config as proxyConfig, proxy } from '../src/proxy'

void test('payload-totp is pinned to the evaluated version', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>
  }
  assert.equal(manifest.dependencies['payload-totp'], '3.0.7')
})

void test('the second factor can only be disabled by the test suite', () => {
  assert.equal(totpDisabled({ NODE_ENV: 'test', PAYLOAD_TOTP_DISABLED: 'true' }), true)
  for (const NODE_ENV of ['production', 'development'] as const)
    assert.equal(totpDisabled({ NODE_ENV, PAYLOAD_TOTP_DISABLED: 'true' }), false)
  assert.equal(totpDisabled({ NODE_ENV: 'test' }), false)
})

void test('pnpm dev:setup: no second factor only in development, on a local _dev database', () => {
  const local = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://site:local_only@127.0.0.1:5434/site_dev',
    PAYLOAD_TOTP_LOCAL_DEV_BYPASS: 'true',
  } as const
  assert.equal(totpDisabled(local), true)
  for (const host of ['localhost', '[::1]'])
    assert.equal(
      totpDisabled({ ...local, DATABASE_URL: `postgres://site:pw@${host}:5432/site_dev` }),
      true,
      host,
    )
  // Refused: production build or server, the test suite, or any other environment.
  for (const NODE_ENV of ['production', 'test'] as const)
    assert.equal(totpDisabled({ ...local, NODE_ENV }), false, NODE_ENV)
  const { DATABASE_URL: url, PAYLOAD_TOTP_LOCAL_DEV_BYPASS: flagValue } = local
  const withoutNodeEnv: Partial<NodeJS.ProcessEnv> = {
    DATABASE_URL: url,
    PAYLOAD_TOTP_LOCAL_DEV_BYPASS: flagValue,
  }
  assert.equal(totpDisabled(withoutNodeEnv as NodeJS.ProcessEnv), false)
  // Refused: the explicit flag written by pnpm dev:setup is missing or not exactly `true`.
  for (const flag of [undefined, '', '1', 'TRUE', 'yes'])
    assert.equal(totpDisabled({ ...local, PAYLOAD_TOTP_LOCAL_DEV_BYPASS: flag }), false)
  // Refused: a database that is not local, or not a `_dev` one.
  for (const DATABASE_URL of [
    undefined,
    '',
    'not a url',
    'postgresql://site:pw@postgres:5432/site_dev',
    'postgresql://site:pw@db.internal.invalid:5432/site_dev',
    'postgresql://site:pw@localhost.attacker.invalid:5432/site_dev',
    'postgresql://site:pw@127.0.0.2:5432/site_dev',
    'postgresql://site:pw@10.0.0.4:5432/site_dev',
    'postgresql://site:pw@127.0.0.1:5434/site',
    'postgresql://site:pw@127.0.0.1:5434/site_dev_copy',
    'postgresql://site:pw@127.0.0.1:5434/app_http_test',
    'mysql://site:pw@127.0.0.1:3306/site_dev',
  ])
    assert.equal(totpDisabled({ ...local, DATABASE_URL }), false, String(DATABASE_URL))
})

void test('the local bypass flag never reaches a production file', () => {
  const productionFiles = [
    'Dockerfile',
    'docker-compose.prod.yml',
    '.env.example',
    ...readdirSync('.github/workflows').map((name) => `.github/workflows/${name}`),
    ...readdirSync('deploy')
      .filter((name) => statSync(`deploy/${name}`).isFile())
      .map((name) => `deploy/${name}`),
  ]
  for (const path of productionFiles)
    assert.doesNotMatch(readFileSync(path, 'utf8'), /PAYLOAD_TOTP_LOCAL_DEV_BYPASS/, path)
  // The image runs as production: the bypass is refused there whatever its environment says.
  assert.match(readFileSync('Dockerfile', 'utf8'), /ENV NODE_ENV=production/)
})

void test('public content keeps anonymous reads; private globals and writes stay wrapped', () => {
  for (const entity of [Media, SiteContent, SiteSettings, LegalPages])
    assert.deepEqual(entity.custom, { totp: { disableAccessWrapper: { read: true } } }, entity.slug)
})

void test('administrators: explicit unlock access, invitation and TOTP reset endpoints', () => {
  assert.ok(Users.access?.unlock)
  assert.deepEqual(
    Users.endpoints && Users.endpoints.map(({ method, path }) => `${method} ${path}`),
    ['post /invite', 'post /:id/reset-totp'],
  )
})

void test('enrolment text tells to keep the key in a password manager, FR and EN', async () => {
  let config = {
    collections: [{ slug: 'users', auth: true, fields: [] }],
    globals: [],
  } as unknown as Config
  for (const plugin of totpPlugins({ NODE_ENV: 'production' })) config = await plugin(config)
  const description = (language: 'fr' | 'en') => {
    const translations = config.i18n?.translations?.[language] as
      { totpPlugin?: { setup?: { description?: string } } } | undefined
    return translations?.totpPlugin?.setup?.description ?? ''
  }
  assert.match(description('fr'), /gestionnaire de mots de passe/)
  assert.match(description('en'), /password manager/)
  assert.ok(config.endpoints?.some((endpoint) => endpoint.path === '/verify-totp'))
})

void test('the proxy covers the administration and sets x-pathname for payload-totp', () => {
  assert.ok(proxyConfig.matcher.includes('/admin'))
  assert.ok(proxyConfig.matcher.includes('/admin/:path*'))
  const response = proxy(
    new NextRequest('http://localhost/admin/collections/users', {
      headers: { 'x-pathname': '/admin/verify-totp' },
    }),
  )
  assert.equal(
    response.headers.get('x-middleware-request-x-pathname'),
    '/admin/collections/users',
    'Jamais la valeur envoyée par le client',
  )
})

void test('invitation email: FR and EN, escaped name, invitation wording', () => {
  const { subject, html, text } = invitationEmail({
    name: '<script>Alice</script>',
    link: 'https://example.test/admin/reset/abc',
  })
  assert.match(subject, /Invitation/)
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;Alice'))
  assert.match(html, /24 heures/)
  assert.match(html, /24 hours/)
  assert.ok(text.includes('https://example.test/admin/reset/abc'))
  assert.ok(!/réinitialis|reset your password/i.test(html))
})

void test('set-password links (invitation, TOTP reset) live 24 hours', () => {
  assert.equal(INVITATION_LIFETIME_MS, 24 * 60 * 60 * 1000)
  const { html, subject } = totpResetEmail({ name: 'Alice', link: 'https://example.test/l' })
  assert.match(subject, /double authentification/)
  assert.match(html, /24 heures/)
  assert.match(html, /24 hours/)
})

void test('reset-password pages send no Referer and are never cached', async () => {
  const rules = await (
    nextConfig as {
      headers: () => Promise<{ source: string; headers: { key: string; value: string }[] }[]>
    }
  ).headers()
  const rule = rules.find((entry) => entry.source === '/admin/reset/:path*')
  assert.ok(rule, 'Règle pour /admin/reset')
  const header = (key: string) => rule.headers.find((entry) => entry.key === key)?.value
  assert.equal(header('Referrer-Policy'), 'no-referrer')
  assert.equal(header('Cache-Control'), 'no-store')
})

void test('API keys stay off on users: they would bypass the second factor', () => {
  const auth = Users.auth
  assert.ok(typeof auth === 'object')
  assert.notEqual(auth.useAPIKey, true)
})

void test('a successful TOTP enrolment is logged with the user id and IP, never the secret', async () => {
  const logs: unknown[][] = []
  const req = {
    user: { id: 7 },
    headers: new Headers({ 'x-real-ip': '203.0.113.9' }),
    payload: { logger: { info: (...args: unknown[]) => logs.push(args) } },
  }
  const handler = auditSetupTotp(async () => Promise.resolve(Response.json({ ok: true })))
  const response = await handler(req as never)
  assert.deepEqual(await response.json(), { ok: true })
  assert.equal(logs.length, 1)
  assert.deepEqual(logs[0]?.[0], { user: 7, ip: '203.0.113.9' })
  const refused = auditSetupTotp(async () => Promise.resolve(Response.json({ ok: false })))
  await refused(req as never)
  assert.equal(logs.length, 1, 'Pas de journal pour un échec')
  let config = {
    collections: [{ slug: 'users', auth: true, fields: [] }],
    globals: [],
  } as unknown as Config
  for (const plugin of totpPlugins({ NODE_ENV: 'production' })) config = await plugin(config)
  const setup = config.endpoints?.find((endpoint) => endpoint.path === '/setup-totp')
  assert.ok(setup && 'audited' in setup.handler, 'Endpoint de configuration journalisé')
})

void test('the TOTP cookie only counts for an account that still has a secret', async () => {
  const strategy = (user: Record<string, unknown> | null) =>
    requireStoredSecret({
      name: 'totp',
      authenticate: async () => Promise.resolve({ user: user as never }),
    })
  const args = {} as never
  assert.equal((await strategy({ id: 1, hasTotp: false }).authenticate(args)).user, null)
  assert.equal((await strategy({ id: 1 }).authenticate(args)).user, null)
  assert.deepEqual((await strategy({ id: 1, hasTotp: true }).authenticate(args)).user, {
    id: 1,
    hasTotp: true,
  })
  assert.equal((await strategy(null).authenticate(args)).user, null)
})

void test('next dev without the second factor never rewrites the import map without it', async () => {
  const local = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://site:local_only@127.0.0.1:5434/site_dev',
    PAYLOAD_TOTP_LOCAL_DEV_BYPASS: 'true',
  } as const
  const applied = async (environment: NodeJS.ProcessEnv) => {
    let config = { collections: [Users], admin: {} } as unknown as Config
    for (const plugin of totpPlugins(environment)) config = await plugin(config)
    return config.admin?.importMap?.autoGenerate
  }
  assert.equal(
    await applied(local),
    false,
    'Local administrator without TOTP: next dev leaves it alone',
  )
  assert.equal(
    await applied({ ...local, PAYLOAD_TOTP_LOCAL_DEV_BYPASS: '' }),
    undefined,
    'Second factor on: Payload’s default, regenerated with it',
  )
  assert.equal(await applied({ ...local, NODE_ENV: 'test' }), undefined, 'Test suite: unchanged')
})

void test('isAdmin: only a user of the users collection can be an administrator', () => {
  const req = (user: unknown) => ({ user }) as unknown as Parameters<typeof isAdmin>[0]
  assert.equal(isAdmin(req({ collection: 'users', role: 'admin' })), true)
  assert.equal(isAdmin(req({ collection: 'customers', role: 'admin' })), false)
  assert.equal(isAdmin(req({ role: 'admin' })), false)
  assert.equal(isAdmin(req({ collection: 'users', role: 'editor' })), false)
  assert.equal(isAdmin(req(null)), false)
  assert.equal(isAdminCollectionUser({ collection: 'users' }), true)
  assert.equal(isAdminCollectionUser({ collection: 'customers' }), false)
  assert.equal(isAdminCollectionUser(undefined), false)
  assert.equal(isAdminCollectionUser('users'), false)
})

void test('maintenance: a signed-in visitor of another collection stays blocked', () => {
  const totp = { collection: 'users', role: 'admin', _strategy: 'totp', hasTotp: true }
  assert.equal(canSeeThroughMaintenance(totp, false), true)
  assert.equal(canSeeThroughMaintenance({ ...totp, collection: 'customers' }, false), false)
  assert.equal(
    canSeeThroughMaintenance({ collection: 'customers', role: 'admin' }, true),
    false,
    'Even with the second factor disabled',
  )
  assert.equal(canSeeThroughMaintenance({ ...totp, _strategy: 'local-jwt' }, false), false)
  assert.equal(canSeeThroughMaintenance({ collection: 'users', role: 'admin' }, true), true)
  assert.equal(canSeeThroughMaintenance(null, false), false)
})

void test('/admin guard: another collection than users goes to /admin/unauthorized', () => {
  const guard = (user: unknown, pathname: string) =>
    adminGuardRedirect({ user, pathname, adminRoute: '/admin' })
  assert.equal(guard({ collection: 'customers' }, '/admin'), '/admin/unauthorized')
  assert.equal(guard({ collection: 'customers' }, '/admin/setup-totp'), '/admin/unauthorized')
  assert.equal(
    guard({ collection: 'customers' }, '/admin/collections/users'),
    '/admin/unauthorized',
  )
  assert.equal(guard({ collection: 'customers' }, '/admin/unauthorized'), null)
  assert.equal(guard({ collection: 'customers' }, '/admin/unauthorized/'), null)
  assert.equal(guard({ collection: 'users', role: 'admin' }, '/admin'), null)
  assert.equal(guard({ collection: 'users', role: 'editor' }, '/admin'), null)
  assert.equal(guard(null, '/admin/login'), null)
  assert.equal(guard(undefined, '/admin'), null)
  // A user without collection is never an administrator either.
  assert.equal(guard({ email: 'a@b.c' }, '/admin'), '/admin/unauthorized')
  assert.equal(
    adminGuardRedirect({ user: { collection: 'customers' }, pathname: '/cms', adminRoute: '/cms' }),
    '/cms/unauthorized',
  )
})

void test('/admin/unauthorized: log out for an administrator, back to the site for a visitor', () => {
  const routes = { adminRoute: '/admin', logoutRoute: '/logout' } as const
  // Payload's logout only ends a `users` session: a visitor would stay signed in, in a loop.
  assert.deepEqual(unauthorizedExit({ collection: 'customers' }, routes), {
    kind: 'site',
    href: '/',
  })
  assert.deepEqual(unauthorizedExit({ id: 1 }, routes), { kind: 'site', href: '/' })
  for (const user of [{ collection: 'users', role: 'editor' }, null, undefined])
    assert.deepEqual(unauthorizedExit(user, routes), { kind: 'logout', href: '/admin/logout' })
  assert.deepEqual(unauthorizedExit(null, { adminRoute: '/cms', logoutRoute: '/sign-out' }), {
    kind: 'logout',
    href: '/cms/sign-out',
  })
  // Administration at the root: never `//logout`, a link to another host.
  assert.deepEqual(unauthorizedExit(null, { adminRoute: '/', logoutRoute: '/logout' }), {
    kind: 'logout',
    href: '/logout',
  })
  // Payload's own unauthorized view is replaced by the core's one, in the generated import map.
  assert.match(
    readFileSync('src/core/payload/config.ts', 'utf8'),
    /views: \{ unauthorized: \{ Component: UNAUTHORIZED_VIEW \} \}/,
  )
  const [file, name] = UNAUTHORIZED_VIEW.split('#')
  assert.ok(
    readFileSync('src/app/(payload)/admin/importMap.js', 'utf8').includes(
      `"${UNAUTHORIZED_VIEW}": ${String(name)}_`,
    ),
    `import map entry for ${String(file)}`,
  )
})

void test('/admin guard runs before payload-totp, which would send the visitor to setup-totp', async () => {
  let config = {
    admin: { components: { providers: [ADMIN_GUARD_PROVIDER] } },
    collections: [{ slug: 'users', auth: true, fields: [] }],
    globals: [],
  } as unknown as Config
  for (const plugin of totpPlugins({ NODE_ENV: 'production' })) config = await plugin(config)
  const providers = (config.admin?.components?.providers ?? []).map((provider) =>
    typeof provider === 'object' ? provider.path : provider,
  )
  const guard = providers.indexOf(ADMIN_GUARD_PROVIDER)
  const totp = providers.indexOf(TOTP_GATE_PROVIDER)
  assert.ok(guard === 0 && totp > guard, `Order of providers: ${providers.join(', ')}`)
})

void test('TOTP on: a visitor session cannot be sent to setup-totp, administrators still are', async () => {
  let config = {
    admin: { components: { providers: [ADMIN_GUARD_PROVIDER] } },
    collections: [{ slug: 'users', auth: true, fields: [] }],
    globals: [],
  } as unknown as Config
  for (const plugin of totpPlugins({ NODE_ENV: 'production' })) config = await plugin(config)
  const providers = (config.admin?.components?.providers ?? []).filter(
    (provider) => typeof provider === 'object',
  )
  assert.ok(!providers.some((provider) => provider.path === PAYLOAD_TOTP_PROVIDER))
  const gate = providers.find((provider) => provider.path === TOTP_GATE_PROVIDER)
  assert.deepEqual(
    (gate?.serverProps as { pluginOptions?: { forceSetup?: boolean } } | undefined)?.pluginOptions
      ?.forceSetup,
    true,
    'payload-totp options are kept (forceSetup stays on for administrators)',
  )
  // The visitor on /admin/unauthorized (the one path the guard lets through) skips payload-totp.
  assert.equal(bypassesTotp({ collection: 'customers' }), true)
  assert.equal(bypassesTotp({ id: 1 }), true)
  assert.equal(bypassesTotp({ collection: 'users', role: 'admin' }), false)
  assert.equal(bypassesTotp({ collection: 'users', role: 'editor' }), false)
  assert.equal(bypassesTotp(null), false)
  // Never when the plugin is off: no provider entry to replace.
  const off = totpPlugins({ NODE_ENV: 'test', PAYLOAD_TOTP_DISABLED: 'true' })
  let disabled = {
    admin: {},
    collections: [{ slug: 'users', auth: true, fields: [] }],
    globals: [],
  } as unknown as Config
  for (const plugin of off) disabled = await plugin(disabled)
  assert.ok(!(disabled.admin?.components?.providers ?? []).length)
})
