// Starter only (perSite in starter.json): scripts/starter-update.mjs on a fake starter and a fake
// site, both temporary git repositories built here.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { after, test } from 'node:test'
import { present } from './support/present'

const TOOL = resolve('scripts/starter-update.mjs')
const temporary: string[] = []
after(() => {
  for (const dir of temporary) rmSync(dir, { recursive: true, force: true })
})

type Files = Record<string, string | Buffer | null>

function repository() {
  const dir = mkdtempSync(join(tmpdir(), 'starter-update-'))
  temporary.push(dir)
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'tests@starter-update.localhost')
  git('config', 'user.name', 'Test')
  const write = (files: Files) => {
    for (const [path, content] of Object.entries(files)) {
      const file = join(dir, path)
      if (content === null) rmSync(file, { force: true })
      else {
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, content)
      }
    }
  }
  const commit = (files: Files, message = 'change') => {
    write(files)
    git('add', '-A')
    git('commit', '-q', '--allow-empty', '-m', message)
    return git('rev-parse', 'HEAD')
  }
  const read = (path: string) =>
    existsSync(join(dir, path)) ? readFileSync(join(dir, path), 'utf8') : null
  return { dir, git, write, commit, read }
}

const manifest = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    pieces: {
      deploy: { files: ['deploy/kit.py', 'scripts/starter-update.mjs'] },
      core: { requires: ['deploy'], files: ['src/**', 'tests/**'] },
      orders: {
        requires: ['core'],
        module: 'orders',
        files: ['src/modules/orders/**'],
        dependencies: ['stripe'],
      },
      ...extra,
    },
    perSite: ['site.config.json', 'package.json', 'src/payload-types.ts', 'src/site/**'],
  })

const lines = (...values: string[]) => values.map((value) => `${value}\n`).join('')
const SHARED = lines('one', 'two', 'three', 'four', 'five', 'six')

/** A fake starter at `base`, a site made from it (pieces deploy, core), then `target`. */
function setup(baseFiles: Files, targetFiles: Files, sitePieces = ['deploy', 'core']) {
  const starter = repository()
  const base = starter.commit({ 'starter.json': manifest(), ...baseFiles }, 'base')
  const site = repository()
  const copied: Files = {}
  for (const [path, content] of Object.entries(baseFiles))
    if (content !== null && path !== 'starter.json') copied[path] = content
  site.commit({
    ...copied,
    'package.json': JSON.stringify({ dependencies: { stripe: '1.0.0' } }),
    '.starter.json': JSON.stringify({
      repository: starter.dir,
      version: base,
      pieces: sitePieces,
      ignore: [],
    }),
  })
  const target = starter.commit(targetFiles, 'feat: the change under test')
  return { starter, site, base, target }
}

const run = (cwd: string, ...args: string[]) => {
  const reports = mkdtempSync(join(tmpdir(), 'starter-report-'))
  temporary.push(reports)
  const result = spawnSync(process.execPath, [TOOL, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, STARTER_UPDATE_REPORT_DIR: reports },
  })
  return { ...result, output: `${result.stdout}${result.stderr}`, reports }
}
const record = (site: { read(path: string): string | null }) =>
  JSON.parse(site.read('.starter.json') ?? '{}') as { version: string; pieces: string[] }

void test('a clean update writes the starter’s new content and the new version', () => {
  const { site, target } = setup(
    { 'src/core/a.ts': SHARED },
    { 'src/core/a.ts': SHARED + 'seven\n' },
  )
  const result = run(site.dir, 'update')
  assert.equal(result.status, 0, result.output)
  assert.equal(site.read('src/core/a.ts'), SHARED + 'seven\n')
  assert.equal(record(site).version, target)
})

void test('a local change on other lines survives the update', () => {
  const { site } = setup(
    { 'src/core/a.ts': SHARED },
    {
      'src/core/a.ts': SHARED.replace('six', 'SIX'),
    },
  )
  site.commit({ 'src/core/a.ts': SHARED.replace('one', 'ONE') })
  assert.equal(run(site.dir, 'update').status, 0)
  assert.equal(site.read('src/core/a.ts'), SHARED.replace('one', 'ONE').replace('six', 'SIX'))
})

void test('the same lines changed on both sides: a conflict, listed, version unchanged', () => {
  const { site, base } = setup(
    { 'src/core/a.ts': SHARED },
    {
      'src/core/a.ts': SHARED.replace('three', 'starter'),
    },
  )
  site.commit({ 'src/core/a.ts': SHARED.replace('three', 'site') })
  const result = run(site.dir, 'update')
  assert.equal(result.status, 1, result.output)
  assert.match(site.read('src/core/a.ts') ?? '', /<<<<<<< site[\s\S]*=======[\s\S]*>>>>>>>/)
  assert.match(result.output, /src\/core\/a\.ts/)
  assert.equal(record(site).version, base)
})

void test('a file added by the starter is created; a missing shared file is added too', () => {
  const { site } = setup(
    { 'src/core/a.ts': SHARED, 'deploy/kit.py': 'kit\n' },
    {
      'src/core/new.ts': 'new\n',
    },
  )
  site.commit({ 'deploy/kit.py': null })
  assert.equal(run(site.dir, 'update').status, 0)
  assert.equal(site.read('src/core/new.ts'), 'new\n')
  assert.equal(site.read('deploy/kit.py'), 'kit\n')
})

void test('a file deleted by the starter goes when unchanged here, stays and is listed otherwise', () => {
  const { site } = setup(
    { 'src/core/a.ts': SHARED, 'src/core/b.ts': SHARED },
    {
      'src/core/a.ts': null,
      'src/core/b.ts': null,
    },
  )
  site.commit({ 'src/core/b.ts': SHARED + 'local\n' })
  const result = run(site.dir, 'update')
  assert.equal(result.status, 0, result.output)
  assert.equal(site.read('src/core/a.ts'), null)
  assert.equal(site.read('src/core/b.ts'), SHARED + 'local\n')
  assert.match(result.output, /src\/core\/b\.ts/)
})

void test('per-site and ignored files are never touched', () => {
  const { site } = setup(
    { 'src/core/a.ts': SHARED, 'src/site/page.ts': 'site\n', 'src/core/own.ts': 'mine\n' },
    {
      'src/core/a.ts': SHARED + 'x\n',
      'src/site/page.ts': 'starter\n',
      'src/core/own.ts': 'theirs\n',
    },
  )
  const current = record(site)
  site.commit({ '.starter.json': JSON.stringify({ ...current, ignore: ['src/core/own.ts'] }) })
  assert.equal(run(site.dir, 'update').status, 0)
  assert.equal(site.read('src/site/page.ts'), 'site\n')
  assert.equal(site.read('src/core/own.ts'), 'mine\n')
  assert.equal(site.read('src/payload-types.ts'), null)
})

void test('a piece the site does not have is untouched and listed as available', () => {
  const { site } = setup(
    { 'src/core/a.ts': SHARED },
    {
      'src/modules/orders/x.ts': 'orders\n',
      'starter.json': manifest({
        accounts: { requires: ['core'], module: 'accounts', files: ['src/modules/accounts/**'] },
      }),
      'src/modules/accounts/y.ts': 'accounts\n',
    },
  )
  const result = run(site.dir, 'update')
  assert.equal(result.status, 0, result.output)
  assert.equal(site.read('src/modules/orders/x.ts'), null)
  assert.equal(site.read('src/modules/accounts/y.ts'), null)
  assert.match(result.output, /orders/)
  assert.match(result.output, /accounts.*nouveau/)
})

void test('the manifest is read at the target version', () => {
  const { site } = setup(
    { 'src/core/moved.ts': 'v1\n' },
    {
      'src/core/moved.ts': 'v2\n',
      'starter.json': manifest({
        orders: {
          requires: ['core'],
          module: 'orders',
          files: ['src/modules/orders/**', 'src/core/moved.ts'],
        },
      }),
    },
  )
  assert.equal(run(site.dir, 'update').status, 0)
  assert.equal(site.read('src/core/moved.ts'), 'v1\n')
})

void test('a dirty working tree is refused, nothing written', () => {
  const { site, base } = setup({ 'src/core/a.ts': SHARED }, { 'src/core/a.ts': 'new\n' })
  site.write({ 'notes.txt': 'work in progress\n' })
  const result = run(site.dir, 'update')
  assert.equal(result.status, 2, result.output)
  assert.equal(site.read('src/core/a.ts'), SHARED)
  assert.equal(record(site).version, base)
})

void test('a second update in a row changes nothing', () => {
  const { site } = setup({ 'src/core/a.ts': SHARED }, { 'src/core/a.ts': SHARED + 'x\n' })
  assert.equal(run(site.dir, 'update').status, 0)
  site.git('add', '-A')
  site.git('commit', '-q', '-m', 'update')
  const again = run(site.dir, 'update')
  assert.equal(again.status, 0, again.output)
  assert.equal(site.git('status', '--porcelain'), '')
})

void test('paths with parentheses and brackets are read and written exactly', () => {
  const path = 'src/app/(frontend)/[locale]/layout.tsx'
  const { site } = setup({ [path]: SHARED }, { [path]: SHARED + 'x\n' })
  assert.equal(run(site.dir, 'update').status, 0)
  assert.equal(site.read(path), SHARED + 'x\n')
})

void test('a binary file is copied when unchanged here, a conflict when both changed', () => {
  const png = (byte: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, byte])
  const { site } = setup(
    { 'src/core/a.png': png(1), 'src/core/b.png': png(1) },
    { 'src/core/a.png': png(2), 'src/core/b.png': png(2) },
  )
  site.commit({ 'src/core/b.png': png(3) })
  const result = run(site.dir, 'update')
  assert.equal(result.status, 1, result.output)
  assert.deepEqual(readFileSync(join(site.dir, 'src/core/a.png')), png(2))
  assert.deepEqual(readFileSync(join(site.dir, 'src/core/b.png')), png(3))
  assert.match(result.output, /src\/core\/b\.png/)
})

void test('a changed collection warns about the migration; dependency versions are compared', () => {
  const { starter, site } = setup(
    { 'src/core/a.ts': SHARED },
    {
      'src/core/collections/things.ts': "import type { CollectionConfig } from 'payload'\n",
      // Outside src/: naming the type is not a collection (the update tool itself does).
      'tests/tool.test.ts': '// mentions CollectionConfig in a comment\n',
    },
  )
  starter.commit({ 'package.json': JSON.stringify({ dependencies: { stripe: '2.0.0' } }) })
  const current = record(site)
  site.commit({
    '.starter.json': JSON.stringify({ ...current, pieces: ['deploy', 'core', 'orders'] }),
  })
  const result = run(site.dir, 'update')
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /migrate:create/)
  assert.match(result.output, /stripe.*1\.0\.0.*2\.0\.0/)
  const warning = result.output.slice(result.output.indexOf('Le schéma'))
  assert.match(warning, /src\/core\/collections\/things\.ts/)
  assert.doesNotMatch(warning, /tests\/tool\.test\.ts/)
})

void test('the pull request description lists the starter’s commits', () => {
  const { site } = setup({ 'src/core/a.ts': SHARED }, { 'src/core/a.ts': SHARED + 'x\n' })
  const result = run(site.dir, 'update')
  const report = /(\S+starter-update-\S+\.md)/.exec(result.output)?.[1]
  assert.ok(report && existsSync(report), result.output)
  assert.match(readFileSync(report, 'utf8'), /feat: the change under test/)
})

void test('add installs a piece and the pieces it requires, at the site’s version', () => {
  const starter = repository()
  const version = starter.commit({
    'starter.json': manifest({
      'payments-stripe': {
        requires: ['orders'],
        module: 'payments-stripe',
        files: ['src/modules/payments-stripe/**'],
      },
    }),
    'src/core/a.ts': SHARED,
    'src/modules/orders/module.ts': 'orders\n',
    'src/modules/payments-stripe/module.ts': 'stripe\n',
    'package.json': JSON.stringify({ dependencies: { stripe: '2.0.0' } }),
  })
  const site = repository()
  site.commit({
    'src/core/a.ts': SHARED,
    '.starter.json': JSON.stringify({
      repository: starter.dir,
      version,
      pieces: ['deploy', 'core'],
      ignore: [],
    }),
  })
  const result = run(site.dir, 'add', 'payments-stripe')
  assert.equal(result.status, 0, result.output)
  assert.equal(site.read('src/modules/orders/module.ts'), 'orders\n')
  assert.equal(site.read('src/modules/payments-stripe/module.ts'), 'stripe\n')
  assert.deepEqual(record(site).pieces, ['deploy', 'core', 'orders', 'payments-stripe'])
  assert.match(result.output, /src\/modules\/index\.ts/)
  assert.match(result.output, /pnpm add stripe@2\.0\.0/)
  assert.match(result.output, /migrate:create/)
})

void test('add names the deploy secrets the new module needs', () => {
  const starter = repository()
  const version = starter.commit({
    'starter.json': manifest({
      accounts: {
        requires: ['core'],
        module: 'accounts',
        files: ['src/modules/accounts/**'],
        secrets: ['BETTER_AUTH_SECRET'],
      },
    }),
    'src/core/a.ts': SHARED,
    'src/modules/accounts/module.ts': 'accounts\n',
  })
  const site = repository()
  site.commit({
    'src/core/a.ts': SHARED,
    '.starter.json': JSON.stringify({
      repository: starter.dir,
      version,
      pieces: ['deploy', 'core'],
      ignore: [],
    }),
  })
  const result = run(site.dir, 'add', 'accounts')
  assert.equal(result.status, 0, result.output)
  const step = present(
    result.output.split('\n').find((line) => line.includes('BETTER_AUTH_SECRET')),
  )
  for (const where of [
    'deploy.requiredSecrets',
    'github.secrets',
    '.github/workflows/deploy.yml',
    'docker-compose.prod.yml',
    'github-secrets.sh',
  ])
    assert.ok(step.includes(where), where)
  // A piece without secrets prints no such step.
  site.git('add', '-A')
  site.git('commit', '-q', '-m', 'accounts')
  const orders = run(site.dir, 'add', 'orders')
  assert.equal(orders.status, 0, orders.output)
  assert.doesNotMatch(orders.output, /requiredSecrets/)
})

void test('add copies the hand-written migrations of the module and registers them', () => {
  const index = (names: string[]) =>
    [
      ...names.map((name) => `import * as migration_${name} from './${name}'`),
      '',
      'export const migrations = [',
      ...names.map(
        (name) =>
          `  {\n    up: migration_${name}.up,\n    down: migration_${name}.down,\n    name: '${name}',\n  },`,
      ),
      ']',
      '',
    ].join('\n')
  const starter = repository()
  const version = starter.commit({
    'starter.json': JSON.stringify({
      pieces: {
        deploy: { files: ['deploy/kit.py', 'scripts/starter-update.mjs'] },
        core: { requires: ['deploy'], files: ['src/**', 'tests/**'] },
        accounts: {
          requires: ['core'],
          module: 'accounts',
          files: ['src/modules/accounts/**'],
          migrations: [
            '20261125_150000_accounts_auth_schema',
            '20261125_151000_accounts_customers',
          ],
        },
      },
      perSite: ['site.config.json', 'package.json', 'src/migrations/**'],
    }),
    'src/core/a.ts': SHARED,
    'src/modules/accounts/module.ts': 'accounts\n',
    // Written by hand (no Payload snapshot): copied. Generated by Payload (snapshot): regenerated.
    'src/migrations/20261125_150000_accounts_auth_schema.ts': 'auth schema\n',
    'src/migrations/20261125_151000_accounts_customers.ts': 'customers\n',
    'src/migrations/20261125_151000_accounts_customers.json': '{}\n',
    'src/migrations/index.ts': index(['20261119_130809_initial']),
  })
  const site = repository()
  site.commit({
    'src/core/a.ts': SHARED,
    'src/migrations/20261201_090000_site.ts': 'site\n',
    'src/migrations/index.ts': index(['20261201_090000_site']),
    '.starter.json': JSON.stringify({
      repository: starter.dir,
      version,
      pieces: ['deploy', 'core'],
      ignore: [],
    }),
  })
  const result = run(site.dir, 'add', 'accounts')
  assert.equal(result.status, 0, result.output)
  assert.equal(site.read('src/migrations/20261125_150000_accounts_auth_schema.ts'), 'auth schema\n')
  assert.equal(site.read('src/migrations/20261125_151000_accounts_customers.ts'), null)
  assert.equal(
    site.read('src/migrations/index.ts'),
    index(['20261201_090000_site', '20261125_150000_accounts_auth_schema']),
  )
  assert.match(result.output, /20261125_150000_accounts_auth_schema/)
  assert.match(result.output, /migrate:create/)
})

void test('add is refused when the site is behind the starter', () => {
  const { site } = setup({ 'src/core/a.ts': SHARED }, { 'src/modules/orders/x.ts': 'x\n' })
  const result = run(site.dir, 'add', 'orders')
  assert.equal(result.status, 2, result.output)
  assert.match(result.output, /starter:update/)
  assert.equal(site.read('src/modules/orders/x.ts'), null)
})

void test('add with an existing different file: a conflict, listed', () => {
  const starter = repository()
  const version = starter.commit({
    'starter.json': manifest(),
    'src/modules/orders/x.ts': 'starter\n',
  })
  const site = repository()
  site.commit({
    'src/modules/orders/x.ts': 'site\n',
    '.starter.json': JSON.stringify({
      repository: starter.dir,
      version,
      pieces: ['deploy', 'core'],
      ignore: [],
    }),
  })
  const result = run(site.dir, 'add', 'orders')
  assert.equal(result.status, 1, result.output)
  assert.match(site.read('src/modules/orders/x.ts') ?? '', /<<<<<<< site/)
})

void test('adopt writes only .starter.json, and refuses when one exists', () => {
  const starter = repository()
  const version = starter.commit({ 'starter.json': manifest(), 'deploy/kit.py': 'kit\n' })
  const site = repository()
  site.commit({ 'README.md': 'site\n' })
  const result = run(site.dir, 'adopt', version, 'deploy', '--repository', starter.dir)
  assert.equal(result.status, 0, result.output)
  assert.deepEqual(record(site), {
    repository: starter.dir,
    version,
    pieces: ['deploy'],
    ignore: [],
  })
  assert.equal(site.git('status', '--porcelain'), '?? .starter.json')
  assert.equal(run(site.dir, 'adopt', version, 'deploy', '--repository', starter.dir).status, 2)
})

void test('adopt then update works without a commit in between (.starter.json is the tool’s own)', () => {
  const starter = repository()
  const version = starter.commit({ 'starter.json': manifest(), 'deploy/kit.py': 'kit\n' })
  const site = repository()
  site.commit({ 'README.md': 'site\n' })
  assert.equal(run(site.dir, 'adopt', version, 'deploy', '--repository', starter.dir).status, 0)
  const result = run(site.dir, 'update')
  assert.equal(result.status, 0, result.output)
  assert.equal(site.read('deploy/kit.py'), 'kit\n')
})

void test('a conflicted update is finished with --continue once no marker remains', () => {
  const { site, base, target } = setup(
    { 'src/core/a.ts': SHARED },
    {
      'src/core/a.ts': SHARED.replace('three', 'starter'),
    },
  )
  site.commit({ 'src/core/a.ts': SHARED.replace('three', 'site') })
  assert.equal(run(site.dir, 'update').status, 1)
  assert.equal((record(site) as { pending?: string }).pending, target)
  const early = run(site.dir, 'update', '--continue')
  assert.equal(early.status, 1, early.output)
  assert.match(early.output, /src\/core\/a\.ts/)
  assert.equal(record(site).version, base)
  site.write({ 'src/core/a.ts': SHARED.replace('three', 'both') })
  const done = run(site.dir, 'update', '--continue')
  assert.equal(done.status, 0, done.output)
  assert.equal(record(site).version, target)
  assert.equal((record(site) as { pending?: string }).pending, undefined)
  assert.equal(site.read('src/core/a.ts'), SHARED.replace('three', 'both'))
})

void test('an executable file keeps its executable bit', () => {
  const starter = repository()
  starter.commit({ 'starter.json': manifest(), 'src/core/run.sh': '#!/bin/sh\n' })
  starter.git('update-index', '--chmod=+x', 'src/core/run.sh')
  starter.git('commit', '-q', '-m', 'exec')
  const version = starter.git('rev-parse', 'HEAD')
  const site = repository()
  site.commit({
    'README.md': 'site\n',
    '.starter.json': JSON.stringify({
      repository: starter.dir,
      version,
      pieces: ['deploy', 'core'],
      ignore: [],
    }),
  })
  assert.equal(run(site.dir, 'update').status, 0)
  assert.ok(statSync(join(site.dir, 'src/core/run.sh')).mode & 0o100)
})

void test('a deleted file’s emptied folder goes too', () => {
  const { site } = setup(
    { 'src/core/gone/a.ts': SHARED, 'src/core/b.ts': SHARED },
    {
      'src/core/gone/a.ts': null,
    },
  )
  assert.equal(run(site.dir, 'update').status, 0)
  assert.ok(!existsSync(join(site.dir, 'src/core/gone')))
  assert.ok(existsSync(join(site.dir, 'src/core')))
})

void test('the report is named after the site, and written before the version is recorded', () => {
  const { site } = setup({ 'src/core/a.ts': SHARED }, { 'src/core/a.ts': SHARED + 'x\n' })
  const result = run(site.dir, 'update')
  const report = /(\S+starter-update-\S+\.md)/.exec(result.output)?.[1] ?? ''
  assert.ok(report.includes(basename(site.dir)), report)
})

void test('a conflict in the update tool itself is flagged first', () => {
  const tool = 'scripts/starter-update.mjs'
  const { site } = setup({ [tool]: SHARED }, { [tool]: SHARED.replace('two', 'starter') })
  site.commit({ [tool]: SHARED.replace('two', 'site') })
  const result = run(site.dir, 'update')
  assert.equal(result.status, 1)
  assert.match(result.output, /l’outil de mise à jour lui-même/)
})

void test('a file that moved to a piece the site lacks is reported, not touched', () => {
  const { site } = setup(
    { 'src/core/moved.ts': 'v1\n' },
    {
      'src/core/moved.ts': 'v2\n',
      'starter.json': manifest({
        orders: {
          requires: ['core'],
          module: 'orders',
          files: ['src/modules/orders/**', 'src/core/moved.ts'],
        },
      }),
    },
  )
  const result = run(site.dir, 'update')
  assert.equal(result.status, 0, result.output)
  assert.equal(site.read('src/core/moved.ts'), 'v1\n')
  assert.match(result.output, /brique absente[\s\S]*src\/core\/moved\.ts/)
})

void test('adopt prints the pieces it records, requirements included', () => {
  const starter = repository()
  const version = starter.commit({ 'starter.json': manifest() })
  const site = repository()
  site.commit({ 'README.md': 'site\n' })
  const result = run(site.dir, 'adopt', version, 'orders', '--repository', starter.dir)
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /deploy, core, orders/)
})
