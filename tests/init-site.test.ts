import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { format, resolveConfig } from 'prettier'
import type { SiteConfig } from '../src/core/site'

// Each test works on a temporary copy (sites/nouveau) next to another site's repository
// (sites/autre), with its own infra registry: the real ones are never read. A site made from the
// starter is already initialised: these tests only run in the starter.
const initialised = (JSON.parse(readFileSync('site.config.json', 'utf8')) as { slug: string }).slug
const starterOnly = { skip: initialised !== 'example' && 'site déjà initialisé' }
// The cases that keep modules need them in this repository (the CI trials remove some).
const allModules = ['accounts', 'addresses', 'orders', 'payments-stripe', 'customer-uploads']
const missing = allModules.filter((name) => !existsSync(join('src/modules', name)))
const withModules = {
  skip:
    (initialised !== 'example' && 'site déjà initialisé') ||
    (missing.length > 0 && `modules retirés : ${missing.join(', ')}`),
}
const roots: string[] = []
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

const registry = {
  sites: [
    {
      name: 'deja',
      project: 'deja-prod',
      database: 'deja',
      user: 'deja',
      mediaVolume: 'deja-prod-media',
      containers: ['web', 'postgres'],
      health: 'https://deja.fr/api/health',
      deployKeyFingerprint: 'SHA256:x8g0HGlQ6yjjaaqc7/gtwEewsEk6SBbOwLgQGz6asLc',
      requiredTables: ['users'],
    },
    {
      name: 'legacy',
      project: 'ancien-prod',
      database: 'ancien',
      user: 'postgres',
      mediaVolume: null,
      containers: ['web', 'postgres'],
      health: 'https://ancien.example.org',
      deployKeyFingerprint: 'SHA256:jVwmn3dnTMGA5W20Zvs5AIZ874ILk+VxiUA4PGHTkLE',
      requiredTables: [],
    },
  ],
}
const other = {
  slug: 'autre',
  identity: { domain: 'autre.fr' },
  app: { port: 3400 },
  modules: { orders: { referencePrefix: 'AU' } },
  deploy: { composeProject: 'autre-prod', directory: '/srv/autre', traefikName: 'autre' },
}

async function setUp({ withTests = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'init-site-'))
  roots.push(root)
  const copy = join(root, 'sites', 'nouveau')
  await mkdir(join(root, 'sites', 'autre'), { recursive: true })
  await writeFile(join(root, 'sites', 'autre', 'site.config.json'), JSON.stringify(other))
  await writeFile(join(root, 'registry.json'), JSON.stringify(registry))
  // The tests folder only when modules are removed (scripts/remove-module.mjs reads tests/support).
  for (const entry of ['src', 'scripts', ...(withTests ? ['tests'] : [])])
    await cp(entry, join(copy, entry), { recursive: true })
  for (const file of [
    'package.json',
    'tsconfig.json',
    'site.config.json',
    'docker-compose.yml',
    '.env.example',
    'starter.json',
    // A real site has it: the configuration is formatted with the repository's print width.
    '.prettierrc.json',
  ])
    await cp(file, join(copy, file))
  await symlink(join(process.cwd(), 'node_modules'), join(copy, 'node_modules'))
  return { root, copy }
}

const valid = {
  slug: 'essai',
  name: 'Atelier Essai',
  domain: 'essai.example.com',
  port: '3510',
  'reference-prefix': 'ES',
  locales: 'fr,en',
  // Every module present kept: the cases below are about the values; the bare default has its own.
  modules: allModules.filter((name) => !missing.includes(name)).join(',') || undefined,
  // This repository as the starter, at its current version (the copy is not a git repository).
  starter: process.cwd(),
  'starter-version': 'HEAD',
}
function initSite(
  { root, copy }: { root: string; copy: string },
  values: Record<string, string | undefined>,
) {
  const all: Record<string, string | undefined> = {
    ...values,
    registry: join(root, 'registry.json'),
    sites: join(root, 'sites'),
  }
  const args = Object.entries(all).flatMap(([key, value]) =>
    value === undefined ? [] : [`--${key}`, value],
  )
  return spawnSync(process.execPath, ['scripts/init-site.mjs', ...args], {
    cwd: copy,
    encoding: 'utf8',
  })
}

/** The files init-site rewrites: the configuration and the developer files bound to it. */
const rewritten = [
  'site.config.json',
  'package.json',
  'docker-compose.yml',
  '.env.example',
  '.starter.json',
]
/** Hash of every other file of the copy (node_modules is a link, left out). */
async function otherFiles(copy: string): Promise<Record<string, string>> {
  const entries = await readdir(copy, { withFileTypes: true, recursive: true })
  const hashes: Record<string, string> = {}
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name)
    if (!entry.isFile() || rewritten.some((file) => path === join(copy, file))) continue
    hashes[path] = createHash('sha256')
      .update(await readFile(path))
      .digest('hex')
  }
  return hashes
}
const keys = (value: unknown): string[] =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, child]) => [
        key,
        ...keys(child).map((k) => `${key}.${k}`),
      ])
    : []

void test(
  'a valid run rewrites only the configuration and prints the next steps',
  starterOnly,
  async () => {
    const where = await setUp()
    const before = await otherFiles(where.copy)
    const starter = JSON.parse(await readFile(join(where.copy, 'site.config.json'), 'utf8')) as {
      github: { secrets: string[]; variables: string[] }
    }
    const result = initSite(where, valid)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(await otherFiles(where.copy), before)

    const text = await readFile(join(where.copy, 'site.config.json'), 'utf8')
    const config = JSON.parse(text) as SiteConfig
    // Written as `pnpm format` would (the static group runs prettier --check).
    const options = await resolveConfig('site.config.json')
    assert.equal(text, await format(text, { ...options, filepath: 'site.config.json' }))
    // Same keys as the starter's: names and paths change, no secret is ever added.
    assert.deepEqual(keys(config), keys(starter))
    assert.equal(config.slug, 'essai')
    assert.deepEqual(config.identity, {
      displayName: 'Atelier Essai',
      domain: 'essai.example.com',
      locales: ['fr', 'en'],
      defaultLocale: 'fr',
    })
    assert.equal(config.app.port, 3510)
    assert.equal(config.app.logService, 'essai')
    if (!missing.includes('orders')) {
      const orders = config.modules.orders
      assert.ok(orders)
      assert.equal(orders.referencePrefix, 'ES')
      assert.equal(orders.accessCookiePrefix, 'es_order_')
    }
    assert.equal(config.deploy.directory, '/srv/essai')
    assert.equal(config.deploy.composeProject, 'essai-prod')
    assert.equal(config.deploy.imageRepository, 'ghcr.io/nayanchauveau/essai')
    assert.equal(config.deploy.volumeOwnerLabel, 'essai.owner')
    assert.deepEqual(config.deploy.volumes, {
      database: 'essai-prod-pgdata',
      media: 'essai-prod-media',
      legacyDatabase: null,
    })
    assert.deepEqual(config.deploy.database, { name: 'essai', user: 'essai' })
    assert.equal(config.deploy.traefikName, 'essai')
    assert.equal(config.deploy.defaultHost, 'essai.example.com')
    for (const host of ['deja.fr', 'ancien.example.org'])
      assert.ok(config.deploy.protectedHosts.includes(host), host)
    assert.ok(!config.deploy.protectedHosts.includes('essai.example.com'))
    assert.deepEqual(config.github, starter.github)
    // Developer files follow (tests/site-config.test.ts): package name, local database, local URL.
    const packageJson = JSON.parse(await readFile(join(where.copy, 'package.json'), 'utf8')) as {
      name: string
    }
    assert.equal(packageJson.name, 'essai')
    const compose = await readFile(join(where.copy, 'docker-compose.yml'), 'utf8')
    assert.match(compose, /^name: essai$/m)
    assert.match(compose, /POSTGRES_DB: essai_dev/)
    assert.doesNotMatch(compose, /example/)
    const env = await readFile(join(where.copy, '.env.example'), 'utf8')
    assert.match(env, /^APP_URL=http:\/\/localhost:3510$/m)
    assert.match(
      env,
      /^DATABASE_URL=postgresql:\/\/essai:essai_local_only@127\.0\.0\.1:\d+\/essai_dev$/m,
    )

    // The copy's own validation (src/core/site.ts) accepts the result.
    const parsed = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', "await import('./src/core/site.ts')"],
      { cwd: where.copy, encoding: 'utf8' },
    )
    assert.equal(parsed.status, 0, parsed.stderr)

    const out = result.stdout
    // Without payments-stripe, the STRIPE_* secrets and variable are not asked for.
    const stripe = (name: string) =>
      missing.includes('payments-stripe') && name.startsWith('STRIPE_')
    for (const name of [...starter.github.secrets, ...starter.github.variables])
      if (!stripe(name)) assert.match(out, new RegExp(`\\b${name}\\b`), name)
    assert.match(out, /ssh-keygen -t ed25519 -C github-actions-essai/)
    assert.match(out, /restrict ssh-ed25519 .* github-actions-essai/)
    assert.match(out, /ssh-keygen -lf /)
    assert.match(out, /"name": "essai"/)
    assert.match(out, /"project": "essai-prod"/)
    assert.match(out, /"health": "https:\/\/essai\.example\.com\/api\/health"/)
    assert.match(out, /python3 scripts\/sites\.py generate/)
  },
)

void test(
  'each value already used elsewhere is refused by name, and nothing is written',
  starterOnly,
  async () => {
    const where = await setUp()
    const config = await readFile(join(where.copy, 'site.config.json'), 'utf8')
    const conflicts: [Record<string, string>, RegExp][] = [
      [{ slug: 'deja' }, /slug deja/],
      [{ slug: 'autre' }, /slug autre/],
      [{ slug: 'ancien' }, /projet compose ancien-prod/],
      [{ port: '3100' }, /port 3100/],
      [{ port: '3300' }, /port 3300/],
      [{ port: '3400' }, /port 3400/],
      [{ domain: 'deja.fr' }, /domaine deja\.fr/],
      [{ domain: 'autre.fr' }, /domaine autre\.fr/],
      ...(missing.includes('orders')
        ? []
        : ([[{ 'reference-prefix': 'AU' }, /préfixe de référence AU/]] as [
            Record<string, string>,
            RegExp,
          ][])),
    ]
    for (const [change, message] of conflicts) {
      const result = initSite(where, { ...valid, ...change })
      assert.notEqual(result.status, 0, JSON.stringify(change))
      assert.match(result.stderr, message, JSON.stringify(change))
      assert.equal(await readFile(join(where.copy, 'site.config.json'), 'utf8'), config)
    }
  },
)

void test(
  'a value already written as a word in the generic code is refused by name, before writing',
  starterOnly,
  async () => {
    const where = await setUp()
    // Generic text of the copy: once initialised, the site-values test would flag these words.
    await writeFile(
      join(where.copy, 'src', 'generic-text.ts'),
      "export const text = 'Une brindille, port 3700, voir chez.atelier.fr'\n",
    )
    const config = await readFile(join(where.copy, 'site.config.json'), 'utf8')
    const conflicts: [Record<string, string>, RegExp][] = [
      [{ slug: 'brindille' }, /brindille.*src\/generic-text\.ts:1/],
      [{ slug: 'brindille-bleue' }, /brindille.*src\/generic-text\.ts:1/],
      [{ name: 'Brindille' }, /Brindille.*src\/generic-text\.ts:1/],
      [{ port: '3700' }, /3700.*src\/generic-text\.ts:1/],
      [{ domain: 'chez.atelier.fr' }, /chez\.atelier\.fr.*src\/generic-text\.ts:1/],
    ]
    for (const [change, message] of conflicts) {
      const result = initSite(where, { ...valid, ...change })
      assert.notEqual(result.status, 0, JSON.stringify(change))
      assert.match(result.stderr, message, JSON.stringify(change))
      assert.match(result.stderr, /choisir une autre valeur/, JSON.stringify(change))
      assert.equal(await readFile(join(where.copy, 'site.config.json'), 'utf8'), config)
    }
    // Only whole words count: `essai` is inside « nécessaire » and « réessayer » of generic text.
    await writeFile(
      join(where.copy, 'src', 'generic-text.ts'),
      "export const text = 'Brindilles nécessaires, réessayer, 37000'\n",
    )
    const accepted = initSite(where, { ...valid, slug: 'brindille', port: '3700' })
    assert.equal(accepted.status, 0, accepted.stderr)
  },
)

void test(
  'malformed values, a missing registry or a site already initialised are refused',
  starterOnly,
  async () => {
    const where = await setUp()
    const refused: Record<string, string | undefined>[] = [
      { slug: 'Essai!' },
      { slug: 'example' },
      { name: undefined },
      { domain: 'essai' },
      { domain: 'essai.invalid' },
      { port: '80' },
      ...(missing.includes('orders') ? [] : [{ 'reference-prefix': 'es' }]),
      { locales: 'fr,de' },
      { locales: 'fr' },
    ]
    for (const change of refused)
      assert.notEqual(initSite(where, { ...valid, ...change }).status, 0, JSON.stringify(change))
    const noRegistry = spawnSync(
      process.execPath,
      [
        'scripts/init-site.mjs',
        ...Object.entries(valid).flatMap(([k, v]) => (v === undefined ? [] : [`--${k}`, v])),
      ],
      { cwd: where.copy, encoding: 'utf8', env: { ...process.env } },
    )
    assert.notEqual(noRegistry.status, 0)
    assert.match(noRegistry.stderr, /sites\.json/)

    assert.equal(initSite(where, valid).status, 0)
    const again = initSite(where, { ...valid, slug: 'encore', port: '3600', domain: 'encore.fr' })
    assert.notEqual(again.status, 0)
    assert.match(again.stderr, /déjà initialisé/)
  },
)

const git = (cwd: string, ...args: string[]) =>
  spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim()

void test(
  'without --modules the site is bare: no module, no reference prefix, deploy and core recorded',
  starterOnly,
  async () => {
    const where = await setUp({ withTests: true })
    const values: Record<string, string | undefined> = {
      ...valid,
      modules: undefined,
      'reference-prefix': undefined,
    }
    const result = initSite(where, values)
    assert.equal(result.status, 0, result.stderr)
    for (const name of ['accounts', 'addresses', 'orders', 'payments-stripe', 'customer-uploads'])
      assert.ok(!(await readdir(join(where.copy, 'src/modules'))).includes(name), name)
    const config = JSON.parse(
      await readFile(join(where.copy, 'site.config.json'), 'utf8'),
    ) as SiteConfig
    assert.equal(config.modules.orders, undefined)
    const record = JSON.parse(await readFile(join(where.copy, '.starter.json'), 'utf8')) as {
      version: string
      pieces: string[]
    }
    assert.deepEqual(record.pieces, ['deploy', 'core'])
    assert.equal(record.version, git(process.cwd(), 'rev-parse', 'HEAD'))
    assert.match(result.stdout, /starter:add/)
    // Never deployed: the visitor accounts module leaves neither migrations nor secret behind.
    if (existsSync('src/modules/accounts')) {
      const index = await readFile(join(where.copy, 'src/migrations/index.ts'), 'utf8')
      assert.doesNotMatch(index, /accounts/)
      assert.ok(
        !existsSync(join(where.copy, 'src/migrations/20261125_150000_accounts_auth_schema.ts')),
      )
      assert.match(index, /20261119_130809_initial/)
    }
    assert.ok(!config.deploy.requiredSecrets?.includes('BETTER_AUTH_SECRET'))
    assert.ok(!config.github.secrets.includes('BETTER_AUTH_SECRET'))
    assert.doesNotMatch(await readFile(join(where.copy, '.env.example'), 'utf8'), /BETTER_AUTH/)
    const secretsToCreate = result.stdout.split('2. Secrets GitHub')[1]?.split('3. Clé')[0] ?? ''
    assert.match(secretsToCreate, /PAYLOAD_SECRET/)
    assert.doesNotMatch(secretsToCreate, /BETTER_AUTH_SECRET/)
  },
)

void test('--modules keeps a module and those it requires', withModules, async () => {
  const where = await setUp({ withTests: true })
  const result = initSite(where, { ...valid, modules: 'payments-stripe' })
  assert.equal(result.status, 0, result.stderr)
  const left = await readdir(join(where.copy, 'src/modules'))
  assert.ok(left.includes('orders') && left.includes('payments-stripe'))
  assert.ok(!left.includes('addresses') && !left.includes('customer-uploads'))
  assert.ok(!left.includes('accounts'))
  const record = JSON.parse(await readFile(join(where.copy, '.starter.json'), 'utf8')) as {
    pieces: string[]
  }
  assert.deepEqual(record.pieces, ['deploy', 'core', 'orders', 'payments-stripe'])
})

void test(
  '--modules accounts keeps its migrations and asks for its secret',
  withModules,
  async () => {
    const where = await setUp({ withTests: true })
    const result = initSite(where, { ...valid, modules: 'accounts', 'reference-prefix': undefined })
    assert.equal(result.status, 0, result.stderr)
    assert.match(
      await readFile(join(where.copy, 'src/migrations/index.ts'), 'utf8'),
      /20261125_150000_accounts_auth_schema/,
    )
    const config = JSON.parse(
      await readFile(join(where.copy, 'site.config.json'), 'utf8'),
    ) as SiteConfig
    assert.ok(config.deploy.requiredSecrets?.includes('BETTER_AUTH_SECRET'))
    assert.match(
      result.stdout.split('2. Secrets GitHub')[1]?.split('3. Clé')[0] ?? '',
      /BETTER_AUTH_SECRET/,
    )
  },
)

void test('the starter version is found from the first commit’s tree', starterOnly, async () => {
  const where = await setUp()
  const starter = join(where.root, 'starter')
  await cp(where.copy, starter, {
    recursive: true,
    filter: (path) => !path.endsWith('node_modules'),
  })
  for (const dir of [starter, where.copy]) {
    git(dir, 'init', '-q', '-b', 'main')
    git(dir, 'add', '-A', '--', '.', ':!node_modules')
    git(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'copy')
  }
  const version = git(starter, 'rev-parse', 'HEAD')
  const result = initSite(where, { ...valid, starter, 'starter-version': undefined })
  assert.equal(result.status, 0, result.stderr)
  const record = JSON.parse(await readFile(join(where.copy, '.starter.json'), 'utf8')) as {
    version: string
  }
  assert.equal(record.version, version)
})

void test('no matching starter version: refused, nothing written', starterOnly, async () => {
  const where = await setUp()
  const before = await readFile(join(where.copy, 'site.config.json'), 'utf8')
  const result = initSite(where, { ...valid, 'starter-version': undefined })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /--starter-version/)
  assert.equal(await readFile(join(where.copy, 'site.config.json'), 'utf8'), before)
})

void test('an existing .starter.json is refused', starterOnly, async () => {
  const where = await setUp()
  await writeFile(join(where.copy, '.starter.json'), '{}')
  const result = initSite(where, valid)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /\.starter\.json/)
})

void test(
  'a refused module removal leaves the repository as it was (nothing half-written)',
  withModules,
  async () => {
    const where = await setUp({ withTests: true })
    // A kept file that imports a module the bare default would remove: remove-module refuses.
    await writeFile(
      join(where.copy, 'src/site/stray.ts'),
      "export { addressesModule } from '../modules/addresses/module'\n",
    )
    const before = await readFile(join(where.copy, 'site.config.json'), 'utf8')
    const result = initSite(where, { ...valid, modules: undefined, 'reference-prefix': undefined })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Retrait des modules/)
    assert.equal(await readFile(join(where.copy, 'site.config.json'), 'utf8'), before)
    assert.ok(!existsSync(join(where.copy, '.starter.json')))
  },
)

void test('an unknown --starter-version is named as such', starterOnly, async () => {
  const where = await setUp()
  const result = initSite(where, { ...valid, 'starter-version': 'nope-not-a-version' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Version du starter introuvable : nope-not-a-version/)
})
