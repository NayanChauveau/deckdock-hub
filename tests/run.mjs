// One entry point locally and in CI. Own every resource; never reuse a developer database.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, open, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createServer } from 'node:net'

// Container, label and temporary names come from the site configuration, so two sites made
// from the same starter can run their suites side by side.
const { slug } = JSON.parse(await readFile('site.config.json', 'utf8'))

const id = randomBytes(6).toString('hex')
const container = `${slug}-tests-${id}`
const build = `.test-build/${id}`
const directory = await mkdtemp(join(tmpdir(), `${slug}-tests-`))
const logPath = join(directory, 'suite.log')
const log = await open(logPath, 'a', 0o600)
const children = new Set()
let containerStarted = false
let interrupted = false
const base = { ...process.env }
// Do not inherit real provider credentials. Explicit empty values prevent dotenv from loading them.
for (const key of Object.keys(base))
  if (/^(STRIPE_|SMTP_|BOOTSTRAP_|EMAIL_|GOOGLE_MAPS_)/.test(key)) base[key] = ''
Object.assign(base, {
  STRIPE_MODE: 'test',
  STRIPE_TEST_SECRET_KEY: '',
  STRIPE_TEST_WEBHOOK_SECRET: '',
  STRIPE_LIVE_SECRET_KEY: '',
  STRIPE_LIVE_WEBHOOK_SECRET: '',
  GOOGLE_MAPS_API_KEY: '',
  SMTP_URL: '',
  EMAIL_FROM: '',
  BOOTSTRAP_ADMIN_EMAIL: '',
  BOOTSTRAP_ADMIN_NAME: '',
  BOOTSTRAP_ADMIN_PASSWORD: '',
  NODE_ENV: 'test',
  // The local development bypass of `pnpm dev:setup` (written in .env) never reaches the suite,
  // except the one stage that checks a visitor on /admin under it (set there explicitly).
  PAYLOAD_TOTP_LOCAL_DEV_BYPASS: '',
  PAYLOAD_SECRET: randomBytes(32).toString('hex'),
  BETTER_AUTH_SECRET: randomBytes(32).toString('hex'),
  JOBS_AUTORUN: 'false',
  COMMERCE_PAYMENT_MODE: 'simulated',
  EMAIL_MODE: 'simulated',
  NEXT_TELEMETRY_DISABLED: '1',
  NEXT_DIST_DIR: build,
  NEXT_TSCONFIG_PATH: `.test-tsconfig-${id}.json`,
  MEDIA_DIR: join(directory, 'media'),
  // DeckDock hub: uploaded decks (/data/hub in production).
  HUB_DATA_DIR: join(directory, 'hub'),
  APP_URL: 'http://127.0.0.1:3201',
  DATABASE_URL: 'postgresql://build:build@127.0.0.1:1/build_test',
})
const stop = async (child) => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((done) => child.once('exit', done))
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }, 5000)
  await exited
  clearTimeout(timer)
}
function launch(command, args, env = base) {
  const child = spawn(command, args, { env, detached: true, stdio: ['ignore', log.fd, log.fd] })
  children.add(child)
  child.once('exit', () => children.delete(child))
  return child
}
async function run(command, args, env = base, timeout = 180000) {
  if (interrupted) throw new Error('Suite interrompue')
  const child = launch(command, args, env)
  const timer = setTimeout(() => void stop(child), timeout)
  try {
    await new Promise((done, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) =>
        code === 0 ? done() : reject(new Error(`${command} ${args.join(' ')} : ${signal || code}`)),
      )
    })
  } finally {
    clearTimeout(timer)
  }
}
async function capture(command, args, env = base) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (data) => {
      output += data
    })
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? done(output.trim()) : reject(new Error(`${command} failed (${code})`)),
    )
  })
}
// `pnpm test` runs every group; CI runs them as parallel jobs with `pnpm test --group=<name>`.
const allGroups = ['static', 'database', 'web', 'browser', 'performance']
const requested = process.argv.find((arg) => arg.startsWith('--group='))?.slice('--group='.length)
const groups = new Set(requested ? requested.split(',') : allGroups)
for (const group of groups)
  if (!allGroups.includes(group)) throw new Error(`Groupe de tests inconnu : ${group}`)
// A stage that needs a module's files (`requires`) is skipped once scripts/remove-module.mjs removed it.
async function stage(group, name, action, requires = []) {
  if (![group].flat().some((wanted) => groups.has(wanted))) return
  const missing = requires.filter((file) => !existsSync(file))
  if (missing.length)
    return console.log(`- ${name} : sans objet (module retiré, ${missing[0]} absent)`)
  const start = Date.now()
  console.log(`→ ${name}`)
  await action()
  console.log(`✓ ${name} (${((Date.now() - start) / 1000).toFixed(1)} s)`)
}
const payload = (args, env = base) =>
  run(
    'node',
    ['--import', 'tsx', 'node_modules/payload/bin.js', '--disable-transpile', ...args],
    env,
  )
async function freePort() {
  const server = createServer()
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}
async function withServer(mode, env, action) {
  const port = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const serverEnv = {
    ...env,
    APP_URL: origin,
    TEST_ORIGIN: origin,
    NODE_ENV: mode === 'start' ? 'production' : 'development',
  }
  const server = launch(
    'node',
    ['node_modules/next/dist/bin/next', mode, '--hostname', '127.0.0.1', '--port', String(port)],
    serverEnv,
  )
  try {
    const deadline = Date.now() + 120000
    while (true) {
      if (server.exitCode !== null || server.signalCode !== null)
        throw new Error('Next.js a quitté avant de devenir disponible')
      try {
        const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(3000) })
        if (response.ok) break
      } catch {}
      if (Date.now() > deadline) throw new Error('Next.js indisponible après 120 s')
      await new Promise((done) => setTimeout(done, 400))
    }
    await action({ ...serverEnv, NODE_ENV: 'test' })
  } finally {
    await stop(server)
  }
}
/**
 * The interpreter of the deckdock checker (Python >= 3.13, as in the image): HUB_PYTHON when set,
 * otherwise the first of python3.14, python3.13 and python3 that is recent enough.
 */
async function hubPython() {
  const candidates = [base.HUB_PYTHON, 'python3.14', 'python3.13', 'python3'].filter(Boolean)
  for (const candidate of candidates) {
    try {
      await capture(candidate, [
        '-c',
        'import sys; sys.exit(0 if sys.version_info >= (3, 13) else 1)',
      ])
      return candidate
    } catch {}
  }
  throw new Error(`Python >= 3.13 introuvable (${candidates.join(', ')}) : définir HUB_PYTHON`)
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    interrupted = true
    for (const child of children) void stop(child)
  })
try {
  await mkdir(resolve(build), { recursive: true })
  await writeFile(
    base.NEXT_TSCONFIG_PATH,
    JSON.stringify({
      extends: './tsconfig.json',
      include: ['next-env.d.ts', 'src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
    }),
  )
  await stage('static', 'Domaine, cas d’usage, architecture, adaptateurs et composants React', () =>
    run('pnpm', ['test:unit']),
  )
  await stage('static', 'Types générés, TypeScript et lint', async () => {
    await payload(['generate:types'])
    // CI diffs the generated types: a schema that depends on the environment (payload-totp
    // turned off) would rewrite them without the TOTP fields (tests/totp.test.ts).
    if (!/^\s+hasTotp\?: boolean \| null;$/m.test(await readFile('src/payload-types.ts', 'utf8')))
      throw new Error('src/payload-types.ts généré sans hasTotp (payload-totp désactivé ?)')
    await payload(['generate:importmap'])
    await run('pnpm', ['type-check'])
    await run('pnpm', ['lint'])
    await run('pnpm', ['format:check'])
  })
  await stage('static', 'Scripts de déploiement (tests locaux)', () =>
    run('python3', ['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py']),
  )
  const password = randomBytes(24).toString('hex')
  await stage(
    ['database', 'web', 'browser', 'performance'],
    'PostgreSQL éphémère et migrations réelles',
    async () => {
      await run(
        'docker',
        [
          'run',
          '--rm',
          '-d',
          '--name',
          container,
          '--label',
          `${slug}.test-suite=true`,
          '-p',
          '127.0.0.1::5432',
          '-e',
          'POSTGRES_PASSWORD',
          '-e',
          'POSTGRES_USER=app',
          '-e',
          'POSTGRES_DB=app_template_test',
          'postgres:18.7-alpine@sha256:b6972e1115a4ff8eba5d7f7d19184926d1e16d7d1136ae1e1a7ebf286da0f015',
        ],
        { ...base, POSTGRES_PASSWORD: password },
      )
      containerStarted = true
      const port = (await capture('docker', ['port', container, '5432/tcp'])).split(':').at(-1)
      base.DATABASE_URL = `postgresql://app:${password}@127.0.0.1:${port}/app_template_test`
      for (let attempt = 0; ; attempt++) {
        try {
          await capture('docker', [
            'exec',
            container,
            'pg_isready',
            '-U',
            'app',
            '-d',
            'app_template_test',
          ])
          break
        } catch {
          if (attempt >= 40) throw new Error('PostgreSQL indisponible')
          await new Promise((done) => setTimeout(done, 500))
        }
      }
      await payload(['migrate'])
      for (const name of [
        'socle',
        'commerce',
        'accounts',
        'decks',
        'decks_http',
        'accounts_http',
        'migration',
        'public',
        'http',
        'browser',
        'performance',
      ])
        await run('docker', [
          'exec',
          container,
          'psql',
          '-U',
          'app',
          '-d',
          'postgres',
          '-v',
          'ON_ERROR_STOP=1',
          '-c',
          `CREATE DATABASE app_${name}_test TEMPLATE app_template_test;`,
        ])
    },
  )
  const environment = (name) => ({
    ...base,
    DATABASE_URL: base.DATABASE_URL.replace('app_template_test', `app_${name}_test`),
    MEDIA_DIR: join(directory, name),
  })
  // Local API scripts that act as an administrator without a browser session run with payload-totp
  // disabled (honoured only with NODE_ENV=test). Next.js servers always run with it.
  const withoutTotp = (env) => ({ ...env, PAYLOAD_TOTP_DISABLED: 'true' })
  await stage(
    'database',
    'Intégration PostgreSQL : comptes, invitations, autorisations, contenus et médias',
    async () => {
      const env = withoutTotp(environment('socle'))
      await payload(['run', 'src/scripts/seed.ts'], env)
      await payload(['run', 'tests/socle.integration.ts'], env)
      await payload(['run', 'tests/admin-accounts.integration.ts'], env)
    },
  )
  await stage(
    'database',
    'Intégration commerce : commandes, paiements, concurrence et rétention',
    () => payload(['run', 'tests/commerce.integration.ts'], withoutTotp(environment('commerce'))),
    ['tests/commerce.integration.ts'],
  )
  await stage(
    'database',
    'Intégration comptes : schéma auth migré, aucune migration Better Auth en attente',
    async () => {
      // Visitor sessions against Payload's own collections, with payload-totp on and then off.
      await payload(['run', 'tests/accounts.integration.ts'], environment('accounts'))
      await payload(['run', 'tests/accounts.integration.ts'], withoutTotp(environment('accounts')))
    },
    ['tests/accounts.integration.ts'],
  )
  await stage(
    'database',
    'Intégration decks : pseudos, decks, jetons de publication, accès et versions immuables',
    () => payload(['run', 'tests/decks.integration.ts'], withoutTotp(environment('decks'))),
    ['tests/decks.integration.ts'],
  )
  await stage('database', 'Migrations : base vide migrée, aucune migration en attente', () =>
    payload(['run', 'tests/migrations.integration.ts'], environment('migration')),
  )
  await stage(['web', 'performance'], 'Build de production sans base disponible', () =>
    run(
      'pnpm',
      ['build'],
      {
        ...base,
        NODE_ENV: 'production',
        // Like the image build: neither a database nor the accounts secret exists at build time.
        BETTER_AUTH_SECRET: '',
        DATABASE_URL: 'postgresql://build:build@127.0.0.1:1/build_test',
      },
      300000,
    ),
  )
  await stage(
    'web',
    'Pages FR/EN et administration (double authentification) sur le build de production',
    () =>
      withServer('start', environment('public'), async (env) => {
        await payload(['run', 'tests/public-site.integration.ts'], withoutTotp(env))
        await payload(['run', 'tests/admin-access.integration.ts'], withoutTotp(env))
      }),
  )
  await stage(
    'web',
    'API HTTP : collections privées, accès à une commande et paiement simulé',
    async () => {
      const env = {
        ...environment('http'),
        NEXT_DIST_DIR: `${build}/http`,
        DEMO_ORDER_FILE: join(directory, 'http-order.json'),
      }
      await payload(['run', 'src/scripts/commerce-demo.ts'], env)
      await withServer('dev', env, (env) =>
        run('node', ['--import', 'tsx', 'tests/commerce.http.ts'], env),
      )
    },
    ['tests/commerce.http.ts', 'src/scripts/commerce-demo.ts'],
  )
  await stage(
    'web',
    'API HTTP comptes : lien magique, lien usagé ou expiré, limite de débit (build de production)',
    async () => {
      const env = {
        ...environment('accounts_http'),
        // The sign-in emails of this server only; honoured in production for a loopback APP_URL.
        ACCOUNTS_TEST_MAILBOX: join(directory, 'accounts-mailbox.jsonl'),
        ACCOUNTS_TEST_MAILBOX_LOCAL_PRODUCTION: 'true',
      }
      // A seeded site open to visitors (maintenance is on by default); one case turns it back on.
      await payload(['run', 'src/scripts/seed.ts'], withoutTotp(env))
      await payload(['run', 'tests/performance.setup.ts'], withoutTotp(env))
      await withServer('start', env, async (env) => {
        await run('node', ['--import', 'tsx', 'tests/accounts.http.ts'], {
          ...env,
          SUITE_LOG: logPath,
        })
        // A visitor on /admin, payload-totp active (spec, point 3).
        await run('node', ['--import', 'tsx', 'tests/accounts-admin.http.ts'], {
          ...env,
          ADMIN_TOTP: 'active',
        })
      })
    },
    ['tests/accounts.http.ts', 'tests/accounts-admin.http.ts'],
  )
  await stage(
    'web',
    'Decks : API de publication, service au plugin et plugin réel (build de production)',
    async () => {
      const env = {
        ...environment('decks_http'),
        HUB_DATA_DIR: join(directory, 'decks-hub'),
        // Small enough to send a larger body quickly; the valid test archives weigh a few KiB.
        HUB_MAX_UPLOAD_BYTES: String(1024 * 1024),
        HUB_PYTHON: await hubPython(),
        PYTHONPATH: resolve('vendor/deckdock'),
      }
      await withServer('start', env, async (env) => {
        await payload(['run', 'tests/decks.http.ts'], withoutTotp(env))
        // Reads back what it publishes, then runs deckdock/addon (../deckdock) when present.
        const addon = resolve(base.DECKDOCK_ADDON_SRC || '../deckdock/addon/src')
        if (!existsSync(join(addon, 'deckdock_addon', 'sources.py')))
          console.log(`  SKIP test réel du plugin : ${addon} absent (dépôt deckdock à côté)`)
        await payload(['run', 'tests/decks.serve.http.ts'], withoutTotp(env))
      })
    },
    ['tests/decks.http.ts', 'tests/decks.serve.http.ts', 'tests/decks.addon.test.py'],
  )
  await stage(
    'web',
    'Visiteur sur /admin, double authentification contournée (administrateur local, next dev)',
    async () => {
      // The local administrator's bypass needs next dev and a local database named *_dev.
      const name = 'app_accounts_admin_dev'
      await run('docker', [
        'exec',
        container,
        'psql',
        '-U',
        'app',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `CREATE DATABASE ${name} TEMPLATE app_template_test;`,
      ])
      const env = {
        ...base,
        DATABASE_URL: base.DATABASE_URL.replace('app_template_test', name),
        MEDIA_DIR: join(directory, 'accounts_admin'),
        NEXT_DIST_DIR: `${build}/http`,
        PAYLOAD_TOTP_LOCAL_DEV_BYPASS: 'true',
        ACCOUNTS_TEST_MAILBOX: join(directory, 'accounts-admin-mailbox.jsonl'),
      }
      // Seeded, then open to visitors (the magic link is refused during maintenance).
      await payload(['run', 'src/scripts/seed.ts'], env)
      await run('docker', [
        'exec',
        container,
        'psql',
        '-U',
        'app',
        '-d',
        name,
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        'UPDATE site_settings SET maintenance = false;',
      ])
      await withServer('dev', env, (env) =>
        run('node', ['--import', 'tsx', 'tests/accounts-admin.http.ts'], {
          ...env,
          ADMIN_TOTP: 'bypassed',
        }),
      )
    },
    ['tests/accounts-admin.http.ts'],
  )
  await stage(
    'browser',
    'Navigateur : accessibilité, mobile, parcours de commande et compte visiteur (Chromium)',
    async () => {
      const env = {
        ...environment('browser'),
        NEXT_DIST_DIR: `${build}/browser`,
        DEMO_ORDER_FILE: join(directory, 'browser-order.json'),
        // The visitor emails of the account journey (tests/e2e/accounts.spec.ts); development server.
        ACCOUNTS_TEST_MAILBOX: join(directory, 'browser-mailbox.jsonl'),
        // The author journey publishes through the API (tests/e2e/decks-author.spec.ts).
        ...(existsSync('tests/e2e/decks-author.spec.ts')
          ? { HUB_PYTHON: await hubPython(), PYTHONPATH: resolve('vendor/deckdock') }
          : {}),
      }
      // The demo order of the order journey (tests/e2e/orders.spec.ts), while orders is kept.
      if (existsSync('src/scripts/commerce-demo.ts'))
        await payload(['run', 'src/scripts/commerce-demo.ts'], env)
      // Seeded and open to visitors with or without orders (maintenance is on by default): the
      // account journey and the public pages are tested as visitors see them.
      await payload(['run', 'src/scripts/seed.ts'], withoutTotp(env))
      await payload(['run', 'tests/performance.setup.ts'], withoutTotp(env))
      await withServer('dev', env, (env) =>
        run(
          'node',
          ['node_modules/@playwright/test/cli.js', 'test'],
          { ...env, E2E_ORIGIN: env.TEST_ORIGIN, E2E_OUTPUT_DIR: join(directory, 'playwright') },
          300000,
        ),
      )
    },
  )
  await stage(
    'performance',
    'Budget de performance : Lighthouse mobile sur le build de production (Chromium)',
    async () => {
      // Measured as once opened to the public: indexing on (PUBLIC_INDEXING), maintenance off.
      const env = { ...environment('performance'), PUBLIC_INDEXING: 'true' }
      const report = join(directory, 'performance.md')
      await payload(['run', 'src/scripts/seed.ts'], withoutTotp(env))
      await payload(['run', 'tests/performance.setup.ts'], withoutTotp(env))
      try {
        await withServer('start', env, (env) =>
          run(
            'node',
            ['--import', 'tsx', 'tests/performance.ts'],
            { ...env, PERFORMANCE_REPORT: report },
            300000,
          ),
        )
      } finally {
        if (existsSync(report)) console.log(await readFile(report, 'utf8'))
      }
    },
  )
  console.log(
    `\nTous les tests sont passés${requested ? ` (groupes : ${[...groups].join(', ')})` : ''}.`,
  )
} catch (error) {
  process.exitCode = 1
  console.error(`\nÉchec : ${error.message}`)
  const output = await readFile(logPath, 'utf8')
  console.error(output.split('\n').slice(-100).join('\n'))
} finally {
  await Promise.all([...children].map(stop))
  if (containerStarted) {
    try {
      await capture('docker', ['rm', '-f', container])
    } catch {
      console.error(`Nettoyage Docker impossible : ${container}`)
      process.exitCode = 1
    }
  }
  await log.close()
  await rm(base.NEXT_TSCONFIG_PATH, { force: true })
  await rm(resolve(build), { recursive: true, force: true })
  await rm(directory, { recursive: true, force: true })
}
