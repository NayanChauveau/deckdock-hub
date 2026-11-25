import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { isLocalDevDatabase as configRule } from '../src/core/admin/totp'
import { bypassFlag, isLocalDevDatabase, prepareEnvironment } from '../scripts/dev-setup.mjs'

const example = readFileSync('.env.example', 'utf8')
const placeholder = /^PAYLOAD_SECRET=(.*)$/m.exec(example)?.[1] ?? ''

function clone(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'dev-setup-'))
  writeFileSync(join(root, '.env.example'), example)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
  return root
}

void test('the setup script and the Payload configuration agree on a local _dev database', () => {
  for (const url of [
    'postgresql://site:pw@127.0.0.1:5434/site_dev',
    'postgres://site:pw@localhost/site_dev',
    'postgresql://site:pw@[::1]:5432/site_dev',
    'postgresql://site:pw@postgres:5432/site_dev',
    'postgresql://site:pw@localhost.attacker.invalid/site_dev',
    'postgresql://site:pw@127.0.0.1:5434/site',
    'postgresql://site:pw@127.0.0.1:5434/site_dev_copy',
    'not a url',
    '',
  ])
    assert.equal(isLocalDevDatabase(url), configRule(url), url)
})

void test('a fresh clone gets .env from .env.example, a generated secret and the local flag', () => {
  const root = clone({})
  const result = prepareEnvironment(root, {})
  assert.equal(result.file, '.env')
  assert.equal(result.created, true)
  const written = readFileSync(join(root, '.env'), 'utf8')
  const secret = /^PAYLOAD_SECRET=(.*)$/m.exec(written)?.[1] ?? ''
  assert.notEqual(secret, placeholder)
  assert.match(secret, /^[0-9a-f]{96}$/)
  assert.match(written, new RegExp(`^${bypassFlag}=true$`, 'm'))
  assert.equal(statSync(join(root, '.env')).mode & 0o077, 0, 'readable by the owner only')
  // The rest of .env.example is kept as is.
  assert.equal(
    written
      .split('\n')
      .filter((line) => !/^(PAYLOAD_SECRET|# pnpm dev:setup|PAYLOAD_TOTP)/.test(line))
      .join('\n')
      .trim(),
    example
      .split('\n')
      .filter((line) => !line.startsWith('PAYLOAD_SECRET'))
      .join('\n')
      .trim(),
  )
})

void test('an existing environment file is never overwritten; the flag is added once', () => {
  const existing = `DATABASE_URL=postgresql://site:pw@127.0.0.1:5434/site_dev\nPAYLOAD_SECRET=${'k'.repeat(40)}\n`
  const root = clone({ '.env': existing })
  const first = prepareEnvironment(root, {})
  assert.equal(first.created, false)
  assert.equal(first.flagAdded, true)
  const after = readFileSync(join(root, '.env'), 'utf8')
  assert.ok(after.startsWith(existing))
  const second = prepareEnvironment(root, {})
  assert.equal(second.flagAdded, false)
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), after)
})

void test('.env.local, when present, is the file used (it wins over .env)', () => {
  const local = `DATABASE_URL=postgresql://site:pw@127.0.0.1:5434/site_dev\nPAYLOAD_SECRET=${'k'.repeat(40)}\n`
  const root = clone({ '.env.local': local })
  const result = prepareEnvironment(root, {})
  assert.equal(result.file, '.env.local')
  assert.equal(existsSync(join(root, '.env')), false)
  assert.match(
    readFileSync(join(root, '.env.local'), 'utf8'),
    new RegExp(`^${bypassFlag}=true$`, 'm'),
  )
})

void test('a database that is not local and _dev is refused before anything is written', () => {
  const remote = `DATABASE_URL=postgresql://site:pw@db.internal.invalid:5432/site_dev\nPAYLOAD_SECRET=${'k'.repeat(40)}\n`
  const root = clone({ '.env': remote })
  assert.throws(() => prepareEnvironment(root, {}), /base locale/)
  assert.equal(readFileSync(join(root, '.env'), 'utf8'), remote)
  // The process environment wins over the files, as for Next.js and Payload.
  const fine = clone({})
  assert.throws(
    () => prepareEnvironment(fine, { DATABASE_URL: 'postgresql://site:pw@127.0.0.1:5434/site' }),
    /base locale/,
  )
})

void test('a missing or placeholder secret is refused', () => {
  const root = clone({
    '.env': `DATABASE_URL=postgresql://site:pw@127.0.0.1:5434/site_dev\nPAYLOAD_SECRET=${placeholder}\n`,
  })
  assert.throws(() => prepareEnvironment(root, {}), /PAYLOAD_SECRET/)
})

void test('package.json exposes pnpm dev:setup', () => {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }
  assert.equal(manifest.scripts['dev:setup'], 'node scripts/dev-setup.mjs')
})
