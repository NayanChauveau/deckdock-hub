import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { allGroups, changeGroups, plan } from '../scripts/ci-changes.mjs'

const without = (skipped: string[]) => changeGroups.filter((group) => !skipped.includes(group))

void test('Lighthouse never runs on a push or a pull request: performance.yml runs it nightly', () => {
  assert.deepEqual(changeGroups, without(['performance']))
  assert.ok(!changeGroups.includes('performance'))
  for (const files of [null, [], ['src/core/ui/button.tsx'], ['tests/performance.ts']])
    assert.ok(!plan(files).groups.includes('performance'), JSON.stringify(files))
  const nightly = readFileSync('.github/workflows/performance.yml', 'utf8')
  assert.match(nightly, /schedule:/)
  assert.match(nightly, /workflow_dispatch:/)
  assert.match(nightly, /pnpm test --group=performance/)
})

void test('unknown change (manual run, first push, rewritten history): every change group runs', () => {
  assert.deepEqual(plan(null), { groups: changeGroups, modules: true })
  assert.deepEqual(plan([]), { groups: changeGroups, modules: true })
})

void test('what the visitor sees changes: browser tests run', () => {
  for (const file of [
    'src/core/ui/button.tsx',
    'src/app/(frontend)/[locale]/page.tsx',
    'src/migrations/20261120_100000_privacy_purchase.ts',
    'public/favicon.ico',
    'package.json',
    'pnpm-lock.yaml',
    'next.config.mjs',
    'site.config.json',
    'tests/e2e/orders.spec.ts',
    'tests/performance.ts',
    'tests/support/analytics-stub.ts',
    'tests/run.mjs',
    'playwright.config.ts',
    'Dockerfile',
    '.nvmrc',
    'tsconfig.json',
    'postcss.config.mjs',
  ])
    assert.deepEqual(plan(['README.md', file]).groups, changeGroups, file)
})

void test('deployment, CI, scripts or unit tests only: no browser tests', () => {
  for (const files of [
    ['deploy/dispatch.py'],
    ['.github/workflows/deploy.yml', 'scripts/ci-changes.mjs'],
    ['tests/analytics.test.ts', 'docs/notes.md'],
    ['tests/commerce.integration.ts'],
  ])
    assert.deepEqual(plan(files).groups, without(['browser']), files.join(', '))
})

void test('module removal trials: only when a module, a page, a test or a script changes', () => {
  for (const file of [
    'src/modules/orders/paths.ts',
    'src/app/(frontend)/[locale]/commande/page.tsx',
    'src/site/messages.ts',
    'src/payload.config.ts',
    'tests/orders.domain.test.ts',
    'scripts/remove-module.mjs',
    'package.json',
    'pnpm-lock.yaml',
  ])
    assert.equal(plan([file]).modules, true, file)
  for (const file of ['src/core/ui/button.tsx', 'deploy/dispatch.py', '.github/workflows/ci.yml'])
    assert.equal(plan([file]).modules, false, file)
})

void test('the groups are those of the test runner', () => {
  const runner = readFileSync('tests/run.mjs', 'utf8')
  assert.ok(
    runner.includes(
      `const allGroups = ${JSON.stringify(allGroups).replaceAll('"', "'").replaceAll(',', ', ')}`,
    ),
  )
})
