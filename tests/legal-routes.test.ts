import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { legalPageKeys, legalSlugs } from '../src/core/i18n/legal'

const folder = 'src/app/(frontend)/[locale]/(legal)'

void test('each legal slug has its route, serving its page; nothing else is a legal route', () => {
  const expected = new Map<string, string>()
  for (const locale of ['fr', 'en'] as const)
    for (const key of legalPageKeys) expected.set(legalSlugs[locale][key], key)
  const routes = readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  assert.deepEqual(routes.sort(), [...expected.keys()].sort())
  for (const [slug, key] of expected) {
    const page = readFileSync(`${folder}/${slug}/page.tsx`, 'utf8')
    assert.ok(page.includes(`legalPage('${key}', '${slug}')`), slug)
    // Read statically by Next.js: a re-export would not count.
    assert.ok(page.includes("export const dynamic = 'force-dynamic'"), slug)
  }
})
