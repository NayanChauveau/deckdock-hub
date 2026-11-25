import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import type { Config } from 'payload'
import { newTotpSecret, totpCode } from './support/totp'

void test('test TOTP helper matches the RFC 6238 SHA-1 vectors', () => {
  // RFC 6238 appendix B secret "12345678901234567890" in base32, last 6 digits of the 8-digit values.
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'
  assert.equal(totpCode(secret, 59_000), '287082')
  assert.equal(totpCode(secret, 1_111_111_109_000), '081804')
  assert.equal(totpCode(secret, 2_000_000_000_000), '279037')
  assert.match(newTotpSecret(), /^[A-Z2-7]{32}$/)
})

void test('turning TOTP off keeps the users schema, so generated types never lose hasTotp', async () => {
  const { totpPlugins } = await import('../src/core/admin/totp')
  const users = (environment: NodeJS.ProcessEnv) => {
    let config = {
      collections: [{ slug: 'users', auth: true, fields: [] }],
      globals: [],
    } as unknown as Config
    for (const plugin of totpPlugins(environment)) config = plugin(config) as Config
    const collection = config.collections?.find((entry) => entry.slug === 'users')
    // UI fields (the enrolment widget) are not in the schema nor in the generated types.
    return (collection?.fields ?? [])
      .filter((field) => field.type !== 'ui')
      .map((field) => ('name' in field ? field.name : '?'))
      .sort()
  }
  const enabled = users({ NODE_ENV: 'production' })
  assert.ok(enabled.includes('hasTotp'))
  assert.deepEqual(users({ NODE_ENV: 'test', PAYLOAD_TOTP_DISABLED: 'true' }), enabled)
})

void test('the committed payload-types.ts is the one generated with TOTP on', () => {
  const types = readFileSync('src/payload-types.ts', 'utf8')
  assert.match(types, /^\s+hasTotp\?: boolean \| null;$/m)
  assert.match(types, /^\s+hasTotp\?: T;$/m)
})
