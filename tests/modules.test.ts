import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveModules } from '../src/core/modules/resolve'
import type { SiteModule } from '../src/core/modules/types'

const a: SiteModule = { name: 'a', dependsOn: [] }
const b: SiteModule = { name: 'b', dependsOn: ['a'], extensions: { a: { x: 1 } } }

void test('modules resolve in dependency order with their extensions', () => {
  const resolved = resolveModules([b, a])
  assert.deepEqual(resolved.names, ['a', 'b'])
  assert.deepEqual(resolved.extensions['a'], [{ x: 1 }])
  assert.deepEqual(resolved.dependencies, { a: [], b: ['a'] })
})

void test('a broken registry is refused', () => {
  assert.throws(() => resolveModules([a, a]), /a/)
  assert.throws(() => resolveModules([b]), /a/)
  assert.throws(() => resolveModules([a, { name: 'c', dependsOn: [], extensions: { a: 1 } }]), /c/)
  assert.throws(
    () =>
      resolveModules([
        { name: 'x', dependsOn: ['y'] },
        { name: 'y', dependsOn: ['x'] },
      ]),
    /cycle/i,
  )
  const collection = { slug: 'orders', fields: [] }
  assert.throws(
    () =>
      resolveModules([
        { name: 'p', dependsOn: [], collections: [collection] },
        { name: 'q', dependsOn: [], collections: [collection] },
      ]),
    /orders/,
  )
})

void test('setup receives the extensions addressed to its module', () => {
  let seen: readonly unknown[] = []
  resolveModules([
    {
      ...a,
      setup: (context) => {
        seen = context.extensionsFor('a')
        return {}
      },
    },
    b,
  ])
  assert.deepEqual(seen, [{ x: 1 }])
})

void test('collections, globals, tasks and queues are gathered in module order', () => {
  const resolved = resolveModules([
    { name: 'p', dependsOn: [], collections: [{ slug: 'one', fields: [] }], queues: ['jobs'] },
    {
      name: 'q',
      dependsOn: ['p'],
      globals: [{ slug: 'two', fields: [] }],
      queues: ['jobs', 'other'],
      setup: () => ({ collections: [{ slug: 'three', fields: [] }] }),
    },
  ])
  assert.deepEqual(
    resolved.collections.map((c) => c.slug),
    ['one', 'three'],
  )
  assert.deepEqual(
    resolved.globals.map((g) => g.slug),
    ['two'],
  )
  assert.deepEqual(resolved.queues, ['jobs', 'other'])
})

void test('dashboard panels of the modules reach the built Payload config, in module order', async () => {
  const keys = ['PAYLOAD_SECRET', 'DATABASE_URL', 'APP_URL'] as const
  const saved = keys.map((key) => process.env[key])
  Object.assign(process.env, {
    PAYLOAD_SECRET: 'x'.repeat(32),
    DATABASE_URL: 'postgres://user:pass@localhost:5432/none',
    APP_URL: 'http://localhost:3000',
  })
  try {
    const { buildSiteConfig } = await import('../src/core/payload/config')
    const panel = '/modules/a/admin/Panel#Panel'
    const other = '/modules/b/admin/Other#Other'
    const config = await buildSiteConfig({
      modules: [
        { ...b, dashboard: [other] },
        { ...a, dashboard: [panel] },
      ],
      baseDir: process.cwd() + '/src',
    })
    const paths = config.admin.components.beforeDashboard.map((entry) =>
      typeof entry === 'string' ? entry : (entry as { path: string }).path,
    )
    assert.deepEqual(paths, [panel, other])
    const bare = await buildSiteConfig({ modules: [a], baseDir: process.cwd() + '/src' })
    assert.deepEqual(bare.admin.components.beforeDashboard, [])
  } finally {
    keys.forEach((key, index) => {
      const value = saved[index]
      if (value === undefined) Reflect.deleteProperty(process.env, key)
      else process.env[key] = value
    })
  }
})
