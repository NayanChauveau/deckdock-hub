import assert from 'node:assert/strict'
import { globSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import '../src/core/zod'
import { z } from 'zod'

void test('zod never probes new Function: the strict CSP would report it (jitless)', () => {
  assert.equal(z.config().jitless, true)
  assert.equal(z.object({ a: z.string() }).parse({ a: 'x' }).a, 'x')
})

void test('every module that imports zod imports src/core/zod.ts first', () => {
  const missing = globSync('src/**/*.{ts,tsx}').filter((file) => {
    if (file === 'src/core/zod.ts') return false
    const source = readFileSync(file, 'utf8')
    const zod = source.search(/^import .* from 'zod(\/[^']*)?'$/m)
    const settings = source.search(/^import '(@\/core|\.)\/zod'$/m)
    return zod !== -1 && (settings === -1 || settings > zod)
  })
  assert.deepEqual(missing, [])
})
