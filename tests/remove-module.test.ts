import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { modules } from '../src/modules'

// Each test works on a temporary copy of the repository; node_modules is linked, not copied. A site
// that already removed a module skips the cases written for the starter's registry.
const registered = new Set(modules.map((entry) => entry.name))
// The cases are written for the starter's modules: a site with modules of its own (which may
// depend on these) skips them; the script itself is the same everywhere.
const starterModules = ['accounts', 'addresses', 'orders', 'payments-stripe', 'customer-uploads']
const own = [...registered].filter((name) => !starterModules.includes(name))
const unless = (...needed: string[]) => ({
  skip:
    (own.length > 0 && `modules propres au site : ${own.join(', ')}`) ||
    (needed.some((name) => !registered.has(name)) && `module retiré : ${needed.join(', ')}`),
})
const copies: string[] = []
after(async () => {
  for (const copy of copies) await rm(copy, { recursive: true, force: true })
})
async function copyRepository(): Promise<string> {
  const copy = await mkdtemp(join(tmpdir(), 'remove-module-'))
  copies.push(copy)
  for (const entry of ['src', 'tests', 'scripts'])
    await cp(entry, join(copy, entry), { recursive: true })
  // .prettierrc.json: the files the script rewrites keep the repository's formatting.
  for (const file of ['package.json', 'tsconfig.json', 'site.config.json', '.prettierrc.json'])
    await cp(file, join(copy, file))
  await symlink(join(process.cwd(), 'node_modules'), join(copy, 'node_modules'))
  return copy
}
const node = (cwd: string, args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', ...args], { cwd, encoding: 'utf8' })
const removeModule = (cwd: string, ...names: string[]) =>
  node(cwd, ['scripts/remove-module.mjs', ...names])
/** The module names of the copy's registry, once resolved (throws if it no longer resolves). */
function registeredNames(cwd: string): string[] {
  const result = node(cwd, [
    '--input-type=module',
    '-e',
    "const { resolveModules } = await import('./src/core/modules/resolve.ts')\n" +
      "const { modules } = await import('./src/modules/index.ts')\n" +
      'console.log(JSON.stringify(resolveModules(modules).names))',
  ])
  assert.equal(result.status, 0, result.stderr)
  return (JSON.parse(result.stdout.trim().split('\n').at(-1) ?? '[]') as string[]).sort()
}

void test(
  'removing addresses deletes its folder, route, tests and registry line',
  unless('accounts', 'addresses', 'orders', 'payments-stripe', 'customer-uploads'),
  async () => {
    const copy = await copyRepository()
    const result = removeModule(copy, 'addresses')
    assert.equal(result.status, 0, result.stderr)
    assert.ok(!existsSync(join(copy, 'src/modules/addresses')))
    assert.ok(!existsSync(join(copy, 'src/app/(frontend)/api/addresses')))
    assert.ok(!existsSync(join(copy, 'tests/addresses.test.ts')))
    assert.ok(!existsSync(join(copy, 'tests/addresses.ui.test.tsx')))
    assert.ok(existsSync(join(copy, 'src/modules/orders/module.ts')))
    assert.ok(existsSync(join(copy, 'src/app/(frontend)/api/commerce/access/route.ts')))
    assert.doesNotMatch(await readFile(join(copy, 'src/modules/index.ts'), 'utf8'), /addresses/i)
    assert.deepEqual(registeredNames(copy), [
      'accounts',
      'customer-uploads',
      'orders',
      'payments-stripe',
    ])
    assert.match(result.stdout, /pnpm db:migrate:create/)
  },
)

void test(
  'removing orders is refused while payments-stripe declares it',
  unless('accounts', 'addresses', 'orders', 'payments-stripe', 'customer-uploads'),
  async () => {
    const copy = await copyRepository()
    const result = removeModule(copy, 'orders')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /payments-stripe/)
    assert.ok(existsSync(join(copy, 'src/modules/orders/module.ts')))
    assert.deepEqual(registeredNames(copy), [
      'accounts',
      'addresses',
      'customer-uploads',
      'orders',
      'payments-stripe',
    ])
  },
)

void test(
  'orders and payments-stripe removed together leave a registry that resolves',
  unless('accounts', 'addresses', 'orders', 'payments-stripe', 'customer-uploads'),
  async () => {
    const copy = await copyRepository()
    const result = removeModule(copy, 'orders', 'payments-stripe')
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(registeredNames(copy), ['accounts', 'addresses', 'customer-uploads'])
    // The job purge is derived from the removed manifests' tasks, for every module.
    assert.match(
      result.stdout,
      /DELETE FROM "payload_jobs" WHERE "task_slug" IN \('commerce-maintenance'\);/,
    )
    assert.doesNotMatch(result.stdout, /accounts-orphan-sweep/)
    for (const gone of [
      'src/modules/orders',
      'src/modules/payments-stripe',
      'src/app/(frontend)/api/commerce',
      'src/app/(frontend)/[locale]/commande',
      'src/scripts/commerce-demo.ts',
      'tests/commerce.integration.ts',
      'tests/payments-stripe.test.ts',
      'tests/e2e/orders.spec.ts',
    ])
      assert.ok(!existsSync(join(copy, gone)), gone)
    const importMap = await readFile(join(copy, 'src/app/(payload)/admin/importMap.js'), 'utf8')
    assert.doesNotMatch(importMap, /modules\/orders\//)
    const { scripts } = JSON.parse(await readFile(join(copy, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
    }
    assert.equal(scripts['commerce:demo'], undefined)
    assert.equal(
      scripts['test:commerce'],
      'node --import tsx --test tests/customer-uploads.test.ts',
    )
  },
)

void test('a name that is not an optional module is refused', unless(), async () => {
  const copy = await copyRepository()
  for (const name of ['core', 'site', 'drawings']) {
    const result = removeModule(copy, name)
    assert.notEqual(result.status, 0, name)
    assert.match(result.stderr, /n’est pas un module optionnel/, name)
  }
  assert.equal(removeModule(copy).status, 2)
})

void test(
  'a kept file that imports the module outside its manifest stops the removal',
  unless('addresses'),
  async () => {
    const copy = await copyRepository()
    await writeFile(
      join(copy, 'src/site/stray.ts'),
      "export { addressMessages } from '@/modules/addresses/messages'\n",
    )
    const result = removeModule(copy, 'addresses')
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /src\/site\/stray\.ts/)
    assert.ok(existsSync(join(copy, 'src/modules/addresses/module.ts')))
  },
)

void test(
  'removing orders and payments-stripe drops their settings, payments and pieces',
  unless('orders', 'payments-stripe'),
  async () => {
    const copy = await copyRepository()
    const record = {
      repository: 'x/y',
      version: 'abc',
      pieces: ['deploy', 'core', 'orders', 'payments-stripe', 'addresses'],
      ignore: [],
    }
    await writeFile(join(copy, '.starter.json'), JSON.stringify(record))
    const result = removeModule(copy, 'payments-stripe', 'orders')
    assert.equal(result.status, 0, result.stderr)
    const config = JSON.parse(await readFile(join(copy, 'site.config.json'), 'utf8')) as {
      modules: Record<string, unknown>
      deploy: { payments?: boolean }
      github: { secrets: string[]; variables: string[] }
    }
    assert.equal(config.modules['orders'], undefined)
    // No payment module, no payments: the deploy kit no longer asks for the Stripe secrets.
    assert.equal(config.deploy.payments, false)
    // The shared deploy workflow names the STRIPE_* secrets: they stay listed, unused.
    assert.ok(config.github.secrets.includes('STRIPE_TEST_SECRET_KEY'))
    const parsed = node(copy, [
      '--input-type=module',
      '-e',
      "const { parseSite } = await import('./src/core/site.ts'); const fs = await import('node:fs'); parseSite(JSON.parse(fs.readFileSync('site.config.json', 'utf8'))); console.log('ok')",
    ])
    assert.equal(parsed.stdout.trim(), 'ok', parsed.stderr)
    const after = JSON.parse(await readFile(join(copy, '.starter.json'), 'utf8')) as {
      pieces: string[]
    }
    assert.deepEqual(after.pieces, ['deploy', 'core', 'addresses'])
  },
)

/** The copy, with the deploy files a module's secrets also reach. */
async function copyWithDeployFiles(): Promise<string> {
  const copy = await copyRepository()
  for (const entry of ['deploy', '.github']) await cp(entry, join(copy, entry), { recursive: true })
  for (const file of ['docker-compose.prod.yml', '.env.example']) await cp(file, join(copy, file))
  return copy
}

void test(
  'removing accounts drops its secret from the configuration and every deploy file',
  unless('accounts'),
  async () => {
    const copy = await copyWithDeployFiles()
    const result = removeModule(copy, 'accounts')
    assert.equal(result.status, 0, result.stderr)
    const config = JSON.parse(await readFile(join(copy, 'site.config.json'), 'utf8')) as {
      deploy: { requiredSecrets: string[] }
      github: { secrets: string[] }
    }
    assert.ok(!config.deploy.requiredSecrets.includes('BETTER_AUTH_SECRET'))
    assert.ok(config.deploy.requiredSecrets.includes('PAYLOAD_SECRET'))
    assert.ok(!config.github.secrets.includes('BETTER_AUTH_SECRET'))
    assert.ok(config.github.secrets.includes('PAYLOAD_SECRET'))
    for (const file of [
      '.github/workflows/deploy.yml',
      'docker-compose.prod.yml',
      '.env.example',
      'tests/fixtures/smoke-plan.json',
      'tests/fixtures/release-plan.json',
    ])
      assert.doesNotMatch(await readFile(join(copy, file), 'utf8'), /BETTER_AUTH_SECRET/, file)
    // The rest of those files is left as it was.
    assert.match(
      await readFile(join(copy, 'docker-compose.prod.yml'), 'utf8'),
      /PAYLOAD_SECRET: \$\{PAYLOAD_SECRET:\?PAYLOAD_SECRET requis\}/,
    )
    assert.match(await readFile(join(copy, '.env.example'), 'utf8'), /^PAYLOAD_SECRET=/m)
    assert.match(result.stdout, /BETTER_AUTH_SECRET/)
    const checked = spawnSync('python3', ['-m', 'unittest', 'tests.test_site_config'], {
      cwd: copy,
      encoding: 'utf8',
    })
    assert.equal(checked.status, 0, checked.stderr)
  },
)

void test(
  'removing accounts names the auth schema to drop, its Traefik paths and its migrations',
  unless('accounts'),
  async () => {
    const copy = await copyRepository()
    const result = removeModule(copy, 'accounts')
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /DROP SCHEMA IF EXISTS "auth" CASCADE/)
    // Its scheduled task always has a run queued in production: those rows go first, or the
    // generated narrowing of the task slug enums fails the migration (and the deploy).
    for (const table of ['payload_jobs_log', 'payload_jobs'])
      assert.match(
        result.stdout,
        new RegExp(`DELETE FROM "${table}" WHERE "task_slug" IN \\('accounts-orphan-sweep'\\);`),
      )
    assert.match(result.stdout, /docker-compose\.prod\.yml/)
    assert.match(result.stdout, /\/api\/auth\/sign-in\/magic-link/)
    for (const name of [
      '20261125_150000_accounts_auth_schema',
      '20261125_151000_accounts_customers',
      '20261125_152000_accounts_orphan_sweep',
    ]) {
      assert.match(result.stdout, new RegExp(name))
      // A deployed site keeps them: its removal migration drops what they created.
      assert.ok(existsSync(join(copy, `src/migrations/${name}.ts`)), name)
    }
  },
)

void test(
  '--delete-migrations also deletes the module migrations, for a site that never deployed it',
  unless('accounts'),
  async () => {
    const copy = await copyRepository()
    const result = removeModule(copy, '--delete-migrations', 'accounts')
    assert.equal(result.status, 0, result.stderr)
    const index = await readFile(join(copy, 'src/migrations/index.ts'), 'utf8')
    for (const name of [
      '20261125_150000_accounts_auth_schema',
      '20261125_151000_accounts_customers',
      '20261125_152000_accounts_orphan_sweep',
    ]) {
      assert.ok(!existsSync(join(copy, `src/migrations/${name}.ts`)), name)
      assert.ok(!existsSync(join(copy, `src/migrations/${name}.json`)), name)
      assert.ok(!index.includes(name), name)
    }
    assert.match(index, /20261119_130809_initial/)
    assert.doesNotMatch(result.stdout, /DROP SCHEMA/)
    assert.doesNotMatch(result.stdout, /db:migrate:create/)
    assert.doesNotMatch(result.stdout, /payload_jobs/, 'never deployed: no queued job to purge')
    const loaded = node(copy, [
      '--input-type=module',
      '-e',
      "const { migrations } = await import('./src/migrations/index.ts'); console.log(migrations.map((m) => m.name).join(','))",
    ])
    assert.equal(loaded.status, 0, loaded.stderr)
    const remaining = loaded.stdout.trim().split('\n').at(-1)?.split(',') ?? []
    assert.ok(remaining.includes('20261119_130809_initial'), remaining.join(','))
    assert.ok(!remaining.some((name) => name.includes('_accounts_')), remaining.join(','))
    assert.notEqual(removeModule(copy, '--unknown', 'addresses').status, 0)
    // A module whose tables came with another migration still needs a removal migration.
    const other = removeModule(copy, '--delete-migrations', 'addresses')
    assert.equal(other.status, 0, other.stderr)
    assert.match(other.stdout, /db:migrate:create/)
  },
)

void test(
  '--delete-migrations is refused on an initialised site (.starter.json): nothing is removed',
  unless('accounts'),
  async () => {
    const copy = await copyRepository()
    await writeFile(
      join(copy, '.starter.json'),
      JSON.stringify({ repository: 'x/y', version: 'abc', pieces: ['deploy', 'core', 'accounts'] }),
    )
    const result = removeModule(copy, '--delete-migrations', 'accounts')
    assert.equal(result.status, 2)
    assert.match(result.stderr, /init-site/)
    assert.ok(existsSync(join(copy, 'src/modules/accounts/module.ts')))
    assert.ok(existsSync(join(copy, 'src/migrations/20261125_150000_accounts_auth_schema.ts')))
  },
)
