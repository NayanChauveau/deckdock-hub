import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  matches,
  parseManifest,
  pieceOf,
  sharedFiles,
  withRequired,
} from '../scripts/starter/manifest.mjs'

const manifest = parseManifest(
  JSON.stringify({
    pieces: {
      deploy: { files: ['deploy/*.py', 'scripts/starter-update.mjs'] },
      core: { requires: ['deploy'], files: ['src/core/**', 'src/app/**'] },
      orders: { requires: ['core'], module: 'orders', files: ['src/modules/orders/**'] },
      'payments-stripe': {
        requires: ['orders'],
        module: 'payments-stripe',
        files: ['src/modules/payments-stripe/**'],
        dependencies: ['stripe'],
      },
    },
    perSite: ['src/app/(frontend)/[locale]/page.tsx', 'src/styles/**'],
  }),
)

void test('globs: * stays in one segment, ** spans any, the rest is literal', () => {
  assert.ok(matches('src/core/**', 'src/core/a/b.ts'))
  assert.ok(matches('src/core/**', 'src/core/a.ts'))
  assert.ok(!matches('src/core/**', 'src/corex.ts'))
  assert.ok(!matches('src/core/**', 'src/core'))
  assert.ok(matches('deploy/*.py', 'deploy/release.py'))
  assert.ok(!matches('deploy/*.py', 'deploy/tests/x.py'))
  assert.ok(matches('src/app/(frontend)/[locale]/page.tsx', 'src/app/(frontend)/[locale]/page.tsx'))
  assert.ok(!matches('src/app/(frontend)/[locale]/page.tsx', 'src/app/(frontend)/l/page.tsx'))
  assert.ok(matches('a.b', 'a.b') && !matches('a.b', 'axb'))
})

void test('a piece brings what it requires, requirements first, once', () => {
  assert.deepEqual(withRequired(manifest, ['payments-stripe']), [
    'deploy',
    'core',
    'orders',
    'payments-stripe',
  ])
  assert.deepEqual(withRequired(manifest, ['orders', 'core']), ['deploy', 'core', 'orders'])
  assert.throws(() => withRequired(manifest, ['accounts']), /accounts/)
})

void test('each file belongs to one piece, per-site files to none', () => {
  assert.equal(pieceOf(manifest, 'src/core/site.ts'), 'core')
  assert.equal(pieceOf(manifest, 'src/modules/orders/paths.ts'), 'orders')
  assert.equal(pieceOf(manifest, 'src/app/(frontend)/[locale]/page.tsx'), null)
  assert.equal(pieceOf(manifest, 'README.md'), null)
  const overlapping = parseManifest(
    JSON.stringify({
      pieces: { a: { files: ['x/**'] }, b: { files: ['x/**'] } },
      perSite: [],
    }),
  )
  assert.throws(() => pieceOf(overlapping, 'x/y.ts'), /a.*b|b.*a/)
  // The most precise pattern wins: an exact path over a pattern, a longer fixed prefix over a shorter.
  const nested = parseManifest(
    JSON.stringify({
      pieces: {
        core: { files: ['src/app/**'] },
        orders: { requires: ['core'], files: ['src/app/api/commerce/**'] },
      },
      perSite: [],
    }),
  )
  assert.equal(pieceOf(nested, 'src/app/api/commerce/access/route.ts'), 'orders')
  assert.equal(pieceOf(nested, 'src/app/robots.ts'), 'core')
  const exact = parseManifest(
    JSON.stringify({
      pieces: {
        deploy: { files: ['deploy/release.py'] },
        core: { requires: ['deploy'], files: ['deploy/**'] },
      },
      perSite: [],
    }),
  )
  assert.equal(pieceOf(exact, 'deploy/release.py'), 'deploy')
  assert.equal(pieceOf(exact, 'deploy/cutover_check.py'), 'core')
})

void test('the shared files of a site: its pieces, minus per-site and ignored files', () => {
  const paths = [
    'deploy/release.py',
    'src/core/site.ts',
    'src/core/zod.ts',
    'src/modules/orders/paths.ts',
    'src/modules/payments-stripe/module.ts',
    'src/styles/site.css',
  ]
  assert.deepEqual(
    sharedFiles(manifest, paths, ['deploy', 'core', 'orders'], ['src/core/zod.ts']),
    ['deploy/release.py', 'src/core/site.ts', 'src/modules/orders/paths.ts'],
  )
  assert.deepEqual(sharedFiles(manifest, paths, ['deploy'], []), ['deploy/release.py'])
})

void test('a manifest with an unknown requirement or a cycle is refused', () => {
  assert.throws(
    () =>
      parseManifest(JSON.stringify({ pieces: { a: { requires: ['b'], files: [] } }, perSite: [] })),
    /b/,
  )
  assert.throws(
    () =>
      parseManifest(
        JSON.stringify({
          pieces: { a: { requires: ['b'], files: [] }, b: { requires: ['a'], files: [] } },
          perSite: [],
        }),
      ),
    /cycl/i,
  )
})

void test('ignore takes patterns too', () => {
  const paths = ['src/core/a.ts', 'src/core/own/x.ts', 'src/core/own/y.ts']
  assert.deepEqual(sharedFiles(manifest, paths, ['deploy', 'core'], ['src/core/own/**']), [
    'src/core/a.ts',
  ])
})

void test('the starter repository: a path, a URL or owner/name on GitHub', async () => {
  const { repositoryUrl } = await import('../scripts/starter/git.mjs')
  assert.equal(repositoryUrl('/tmp/starter'), '/tmp/starter')
  assert.equal(repositoryUrl('../site-starter'), '../site-starter')
  assert.equal(
    repositoryUrl('NayanChauveau/site-starter'),
    'https://github.com/NayanChauveau/site-starter.git',
  )
  assert.equal(repositoryUrl('git@github.com:o/n.git'), 'git@github.com:o/n.git')
  assert.equal(repositoryUrl('https://example.test/o/n.git'), 'https://example.test/o/n.git')
})
