// Starter only (perSite in starter.json): every file of the starter belongs to a piece or is per
// site, and each module piece holds exactly what its module manifest declares.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { modules } from '../src/modules'
import { repositoryFiles } from '../scripts/repository-files.mjs'
import { isPerSite, parseManifest, pieceOf, withRequired } from '../scripts/starter/manifest.mjs'

const manifest = parseManifest(readFileSync('starter.json', 'utf8'))
const files = repositoryFiles('.')

void test('every file of the starter belongs to exactly one piece, or is per site', () => {
  const unclassified = files.filter(
    (path) => !isPerSite(manifest, path) && pieceOf(manifest, path) === null,
  )
  assert.deepEqual(unclassified, [])
})

void test('each module piece holds its folder, routes and files, and requires what it depends on', () => {
  for (const entry of modules) {
    const piece = manifest.pieces[entry.name]
    assert.ok(piece, `piece ${entry.name}`)
    assert.equal(piece.module, entry.name)
    const declared = [
      ...files.filter((path) => path.startsWith(`src/modules/${entry.name}/`)),
      ...(entry.routes ?? []),
      ...(entry.files ?? []),
    ]
    for (const path of declared) assert.equal(pieceOf(manifest, path), entry.name, path)
    const requiredModules = withRequired(manifest, [entry.name]).filter(
      (name) => name !== entry.name && manifest.pieces[name]?.module,
    )
    assert.deepEqual(requiredModules.sort(), [...entry.dependsOn].sort(), entry.name)
    // pnpm starter:add reads the secrets and migrations from starter.json (it runs before the
    // manifests can load).
    assert.deepEqual(piece.secrets ?? [], [...(entry.secrets ?? [])], entry.name)
    assert.deepEqual(piece.migrations ?? [], [...(entry.migrations ?? [])], entry.name)
  }
})

void test('per-site, generated and starter-only files are never shared', () => {
  for (const path of [
    'site.config.json',
    'package.json',
    'pnpm-lock.yaml',
    'docker-compose.yml',
    '.env.example',
    'README.md',
    'deploy/README.md',
    'public/site-icon.svg',
    'src/site/messages.ts',
    'src/migrations/index.ts',
    'src/modules/index.ts',
    'src/app/(frontend)/[locale]/page.tsx',
    'src/styles/site.css',
    'src/payload-types.ts',
    'tests/fixtures/release-plan.json',
    'src/app/(payload)/admin/importMap.js',
    'scripts/init-site.mjs',
    'tests/init-site.test.ts',
    'tests/no-manon-data.test.ts',
    'tests/starter-coverage.test.ts',
    'starter.json',
  ])
    assert.equal(pieceOf(manifest, path), null, path)
})

void test('the deploy piece is the kit and the update command; the socle requires it', () => {
  for (const path of [
    'deploy/release.py',
    'deploy/KIT.sha256',
    'tests/test_kit_parity.py',
    'scripts/starter-update.mjs',
    'scripts/starter/manifest.mjs',
  ])
    assert.equal(pieceOf(manifest, path), 'deploy', path)
  assert.deepEqual(manifest.pieces['deploy']?.requires ?? [], [])
  assert.deepEqual(withRequired(manifest, ['core']), ['deploy', 'core'])
  for (const path of ['src/proxy.ts', 'src/core/site.ts', 'deploy/cutover_check.py', 'Dockerfile'])
    assert.equal(pieceOf(manifest, path), 'core', path)
})

void test('the npm dependencies a piece declares exist in package.json', () => {
  const declared = JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const known = { ...declared.dependencies, ...declared.devDependencies }
  for (const [name, piece] of Object.entries(manifest.pieces))
    for (const dependency of piece.dependencies ?? [])
      assert.ok(dependency in known, `${name}: ${dependency}`)
})

void test('every file of the deploy kit (deploy/KIT.sha256) is in the deploy piece', () => {
  const kit = readFileSync('deploy/KIT.sha256', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => `deploy/${line.trim().split(/\s+/)[1] ?? ''}`)
  assert.ok(kit.length > 0)
  for (const path of kit) assert.equal(pieceOf(manifest, path), 'deploy', path)
})
