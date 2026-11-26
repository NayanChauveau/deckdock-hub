import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { resolveModules } from '../src/core/modules/resolve'
import { modules } from '../src/modules'
import {
  hexagonViolations,
  importViolations,
  ownershipViolations,
  sharedKernelViolations,
  sourceFiles,
} from './support/architecture'

void test('a deliberate bad import is reported', () => {
  const dependencies = { orders: [], catalog: ['orders'] }
  const violations = importViolations(
    [
      { path: 'src/core/x.ts', source: "import '../modules/orders/a'" },
      { path: 'src/modules/orders/a.ts', source: "import type { D } from '../catalog/d'" },
      {
        path: 'src/modules/catalog/d.ts',
        source: "export * from '@/modules/orders/a'\nconst s = import('@/site/messages')",
      },
    ],
    dependencies,
  )
  assert.equal(violations.length, 3, violations.join('\n'))
  assert.ok(
    violations.every((line) => /^src\/\S+: .+ \(.+\)$/.test(line)),
    violations.join('\n'),
  )
})

void test('the tree respects the layers', async () => {
  const resolved = resolveModules(modules)
  assert.deepEqual(importViolations(await sourceFiles('src'), resolved.dependencies), [])
})

void test('a deliberate break of the hexagon is reported', () => {
  const dependencies = { orders: [], catalog: ['orders'] }
  const violations = hexagonViolations(
    [
      { path: 'src/modules/orders/domain/a.ts', source: "import '../application/ports'" },
      { path: 'src/modules/orders/application/b.ts', source: "import ts from 'typescript'" },
      { path: 'src/modules/orders/application/c.ts', source: "import '@/core/site'" },
      { path: 'src/modules/orders/application/d.ts', source: "import '../infrastructure/db'" },
      { path: 'src/modules/catalog/application/e.ts', source: "import '../../orders/payload/x'" },
      { path: 'src/modules/orders/application/f.ts', source: "import '../../catalog/domain/y'" },
      { path: 'src/modules/orders/application/g.ts', source: 'const now = new Date()' },
      { path: 'src/modules/orders/application/h.ts', source: 'const id = Math.random()' },
      { path: 'src/modules/orders/application/i.ts', source: 'const env = process.env' },
      { path: 'src/modules/orders/application/j.ts', source: "const x = require('pg')" },
      { path: 'src/modules/orders/application/k.ts', source: "const m = import('./ports')" },
      {
        path: 'src/modules/catalog/application/ok.ts',
        source:
          "import '../../orders/application/ports'\nimport '../domain/z'\nconst d = new Date(0)",
      },
      { path: 'src/modules/orders/payload/ok.ts', source: "import { Stripe } from 'stripe'" },
    ],
    dependencies,
  )
  assert.equal(violations.length, 11, violations.join('\n'))
  const kernel = hexagonViolations(
    [
      { path: 'src/modules/orders/domain/k.ts', source: "import '@/core/domain/x'" },
      { path: 'src/modules/orders/application/k.ts', source: "import '../../../core/domain/x'" },
      { path: 'src/modules/orders/domain/s.ts', source: "import '@/core/site'" },
    ],
    dependencies,
  )
  assert.equal(kernel.length, 1, kernel.join('\n'))
  assert.match(kernel[0] ?? '', /s\.ts.*@\/core\/site/)
})

void test('the shared kernel src/core/domain imports only itself', async () => {
  assert.equal(
    sharedKernelViolations([
      { path: 'src/core/domain/a.ts', source: "import './b'\nimport '@/core/domain/c'" },
      { path: 'src/core/domain/d.ts', source: "import { z } from 'zod'" },
      { path: 'src/core/domain/e.ts', source: "import '@/core/site'" },
    ]).length,
    2,
  )
  assert.deepEqual(sharedKernelViolations(await sourceFiles('src/core/domain')), [])
})

void test('domain and application layers of every module point strictly inward', async () => {
  const resolved = resolveModules(modules)
  assert.deepEqual(hexagonViolations(await sourceFiles('src/modules'), resolved.dependencies), [])
})

void test('every module folder is registered and every owned route or file exists', async () => {
  const resolved = resolveModules(modules)
  const folders = (await readdir('src/modules', { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  assert.deepEqual(folders, [...resolved.names].sort())
  for (const file of Object.values(resolved.routes).flat()) assert.ok(existsSync(file), file)
  for (const file of modules.flatMap((entry) => entry.files ?? []))
    assert.ok(existsSync(file), file)
})

void test('a deliberate import of a module from a file it does not own is reported', () => {
  const owners = {
    orders: ['tests/orders.test.ts', 'src/scripts/previews.ts'],
    payments: ['tests/payments.test.ts'],
  }
  const dependencies = { orders: [], payments: ['orders'], addresses: [] }
  const violations = ownershipViolations(
    [
      { path: 'src/site/home.ts', source: "import '@/modules/orders/messages'" },
      { path: 'tests/orders.test.ts', source: "import '../src/modules/addresses/x'" },
      { path: 'tests/payments.test.ts', source: "import '../src/modules/orders/x'" },
      { path: 'tests/orders.test.ts', source: "import '../src/modules/orders/x'" },
      { path: 'tests/registry.test.ts', source: "import { modules } from '../src/modules'" },
      { path: 'src/modules/orders/a.ts', source: "import '../addresses/x'" },
      { path: 'src/scripts/send.ts', source: "import { previews } from './previews'" },
    ],
    owners,
    dependencies,
  )
  assert.equal(violations.length, 3, violations.join('\n'))
})

void test('a file outside src/modules that imports a module is listed by that module', async () => {
  const resolved = resolveModules(modules)
  const owners = Object.fromEntries(
    modules.map((entry) => [entry.name, [...(entry.routes ?? []), ...(entry.files ?? [])]]),
  )
  const files = [...(await sourceFiles('src')), ...(await sourceFiles('tests'))]
  assert.deepEqual(ownershipViolations(files, owners, resolved.dependencies), [])
})

void test('the old shared folders are gone', () => {
  for (const folder of [
    'src/lib',
    'src/access',
    'src/admin',
    'src/collections',
    'src/globals',
    'src/fields',
    'src/i18n',
    'src/contracts',
    'src/components',
  ])
    assert.ok(!existsSync(folder), folder)
})

// A site that removed modules (scripts/remove-module.mjs) keeps the dependencies of the others; a
// site's own modules (not from the starter) are left out of this check.
const starterDependencies: Record<string, readonly string[]> = {
  accounts: [],
  orders: [],
  'customer-uploads': [],
  addresses: [],
  'payments-stripe': ['orders'],
}
void test('the registry lists its modules with their declared dependencies', () => {
  const resolved = resolveModules(modules).dependencies
  const dependencies = Object.fromEntries(
    Object.entries(resolved).filter(([name]) => name in starterDependencies),
  )
  assert.deepEqual(
    dependencies,
    Object.fromEntries(
      Object.entries(starterDependencies).filter(([name]) => name in dependencies),
    ),
  )
})

const coreRoutes = ['csp-report', 'health', 'ready']
void test('route files under src/app/(frontend)/api only re-export module handlers', async () => {
  const resolved = resolveModules(modules)
  const files = (await readdir('src/app/(frontend)/api', { recursive: true }))
    .filter((file) => file.endsWith('route.ts'))
    .filter((file) => !coreRoutes.includes(file.split('/')[0] ?? ''))
    .map((file) => `src/app/(frontend)/api/${file}`)
  assert.ok(files.length > 0 || modules.length === 0)
  for (const file of files) {
    const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest)
    const owners = new Set<string>()
    for (const statement of source.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        const owner = /^@\/modules\/([^/]+)\//.exec(statement.moduleSpecifier.text)?.[1]
        assert.ok(owner, `${file}: re-exports ${statement.moduleSpecifier.text}`)
        owners.add(owner)
        continue
      }
      const literalConfig =
        ts.isVariableStatement(statement) &&
        statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) &&
        statement.declarationList.declarations.every(
          (declaration) =>
            declaration.initializer &&
            (ts.isStringLiteral(declaration.initializer) ||
              ts.isNumericLiteral(declaration.initializer)),
        )
      assert.ok(literalConfig, `${file}: holds logic instead of re-exporting a module handler`)
    }
    assert.equal(owners.size, 1, `${file}: one owning module`)
    const [owner] = [...owners]
    assert.ok(
      (resolved.routes[owner ?? ''] ?? []).includes(file),
      `${file}: not listed in the routes of ${owner ?? '?'}`,
    )
  }
})

void test(
  'removing a module that no other module needs leaves a registry that still resolves',
  { skip: modules.length === 0 && 'aucun module' },
  () => {
    const needed = new Set(modules.flatMap((entry) => entry.dependsOn))
    const leaves = modules.filter((entry) => !needed.has(entry.name))
    assert.ok(leaves.length > 0)
    for (const leaf of leaves)
      assert.doesNotThrow(
        () => resolveModules(modules.filter((entry) => entry !== leaf)),
        leaf.name,
      )
  },
)

void test('no rendering in the business layers: domain and application hold no HTML', async () => {
  // Presentation (markup, inline styles, a site's colours) belongs to adapters: the order emails
  // are a document built by the application and rendered by adapters/email.
  const markup = /<(table|tr|td|p|a|div|span|br|img)\b|style="/
  // One exception: the decks card preview's template engine, whose output is the markup Anki
  // itself produces for a card (`<span class="cloze">`), shown only in a sandboxed document.
  const allowed = new Set(['src/modules/decks/application/preview.ts'])
  const offenders = (await sourceFiles('src/modules'))
    .filter(({ path }) => !allowed.has(path))
    .filter(({ path }) => /^src\/modules\/[^/]+\/(domain|application)\//.test(path))
    .filter(({ source }) => markup.test(source))
    .map(({ path }) => path)
  assert.deepEqual(offenders, [])
})
