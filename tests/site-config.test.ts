import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { devOrigin, parseSite, site } from '../src/core/site'
import { locales } from '../src/core/i18n/locales'
import { modules } from '../src/modules'

interface RawConfig {
  app: { port: number }
  deploy: {
    directory: string
    composeProject: string
    traefikName: string
    defaultHost: string
    protectedHosts: string[]
    volumes: { media: string | null }
  }
}

const rawConfig = JSON.parse(readFileSync('site.config.json', 'utf8')) as RawConfig

void test('the site configuration is complete and consistent', () => {
  assert.equal(site.deploy.directory, `/srv/${site.slug}`)
  assert.equal(site.deploy.composeProject, `${site.slug}-prod`)
  assert.ok(
    Object.values(site.deploy.volumes).every(
      (volume) => volume === null || volume.startsWith(`${site.deploy.composeProject}-`),
    ),
  )
  assert.deepEqual(site.identity.locales, [...locales])
  assert.equal(devOrigin, `http://localhost:${site.app.port}`)
})

void test('a configuration edited only in part is refused', () => {
  const changes: ((config: RawConfig) => void)[] = [
    (config) => {
      config.deploy.directory = '/srv/another-site'
    },
    (config) => {
      config.deploy.composeProject = 'another-site-prod'
    },
    (config) => {
      config.deploy.volumes.media = 'another-site-prod-media'
    },
    (config) => {
      config.deploy.traefikName = 'another-site'
    },
    (config) => {
      config.deploy.defaultHost = config.deploy.protectedHosts[0] ?? 'fontus.fr'
    },
    (config) => {
      config.app.port = 80
    },
  ]
  for (const change of changes) {
    const copy = structuredClone(rawConfig)
    change(copy)
    assert.throws(() => parseSite(copy))
  }
})

void test('every secret and variable used by the workflows is listed, and nothing else', () => {
  const secrets = new Set<string>()
  const variables = new Set<string>()
  for (const file of readdirSync('.github/workflows').filter((name) => name.endsWith('.yml')))
    for (const match of readFileSync(`.github/workflows/${file}`, 'utf8').matchAll(
      /\b(secrets|vars)\.([A-Z0-9_]+)/g,
    )) {
      const [, kind, name] = match
      if (!name || name === 'GITHUB_TOKEN') continue
      ;(kind === 'secrets' ? secrets : variables).add(name)
    }
  assert.deepEqual([...secrets].sort(), [...site.github.secrets].sort())
  assert.deepEqual([...variables].sort(), [...site.github.variables].sort())
})

void test('developer files agree with the site configuration', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }
  assert.equal(packageJson.name, site.slug)
  assert.ok(readFileSync('.env.example', 'utf8').includes(`APP_URL=${devOrigin}`))
  assert.match(readFileSync('docker-compose.yml', 'utf8'), new RegExp(`^name: ${site.slug}$`, 'm'))
})

void test('the secrets and migrations of each kept module are configured and present', () => {
  const migrations = readFileSync('src/migrations/index.ts', 'utf8')
  for (const entry of modules) {
    for (const name of entry.secrets ?? []) {
      assert.ok(site.deploy.requiredSecrets?.includes(name), `deploy.requiredSecrets : ${name}`)
      assert.ok(site.github.secrets.includes(name), `github.secrets : ${name}`)
    }
    for (const name of entry.migrations ?? []) {
      assert.ok(existsSync(`src/migrations/${name}.ts`), name)
      assert.ok(migrations.includes(`name: '${name}'`), name)
    }
  }
})
