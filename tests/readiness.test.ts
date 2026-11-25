import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readiness } from '../src/core/http/readiness'

const flag = join(mkdtempSync(join(tmpdir(), 'ready-')), 'draining')

void test('ready answers 200 while the container takes traffic', async () => {
  const response = readiness(flag)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ready' })
})

void test('ready answers 503 once the deploy marks the container as draining', async () => {
  writeFileSync(flag, '')
  try {
    const response = readiness(flag)
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), { status: 'draining' })
  } finally {
    rmSync(flag, { force: true })
  }
})
