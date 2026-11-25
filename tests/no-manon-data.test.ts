import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { repositoryFiles } from '../scripts/repository-files.mjs'

// The starter was extracted from the first site built on it. Nothing of that site's identity or
// business data may remain. Names are assembled from parts and personal data is only held as
// SHA-256 hashes, so this file does not itself carry what it forbids.
const first = ['ma', 'non'].join('')
const last = ['kar', 'senti'].join('')
const names = new RegExp([first, last, `${first}${last}`, ['\\bM', 'K-'].join('')].join('|'), 'i')

/** SHA-256 of the SIREN, SIRET, street, town, postcode and email (normalised, lower case). */
const hashed = new Set([
  '30cbf92ec61b526284cae01e600c6d9586506c67b8030b5aa5e7df33ee3500ee',
  'ab1da9d69f56bf5fc0f22f99c31419334e48344a82481b59f622dabe86703154',
  '217dad851aa0d081d62b72e62ff316a363c48d833877ad6cdff2af9d27e6cb69',
  '54922a59e6ec26ef8faee676b2b779b527adf0d1a2bed6d9f653cda4c6769ed8',
  'c49f0370581ee62d963553612b558de63ea9d55f8448a0cde60ebd5508758513',
  '42b49dd4b84b15545b3b13591919a45739a1befa19765924b754e917cfecd377',
])
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** Words (letters, digits, `@._-`) and digit runs written with spaces (SIRET as `123 456 789`). */
function candidates(text: string): Set<string> {
  const found = new Set<string>()
  const normalised = text.normalize('NFC').toLowerCase()
  for (const word of normalised.match(/[\p{L}\p{N}@._-]+/gu) ?? [])
    found.add(word.replace(/^[._-]+|[._-]+$/g, ''))
  for (const run of normalised.match(/\d(?:[\d ]*\d)?/g) ?? []) {
    const digits = run.replace(/ /g, '')
    for (const size of [5, 9, 14])
      for (let start = 0; start + size <= digits.length; start++)
        found.add(digits.slice(start, start + size))
  }
  return found
}

/**
 * The deploy kit protects the production sites already on the server: their hosts and health URL
 * are the only place one of them may be named.
 */
function withoutProtectedSites(path: string, text: string): string {
  if (path !== 'site.config.json') return text
  const config = JSON.parse(text) as { deploy: Record<string, unknown> }
  delete config.deploy['protectedHosts']
  delete config.deploy['protectedHealthUrl']
  return JSON.stringify(config, null, 2)
}

const files = repositoryFiles()

void test('no name, reference prefix or business data of the first site remains', () => {
  const offenders: string[] = []
  for (const path of files) {
    if (path === 'tests/no-manon-data.test.ts') continue
    if (names.test(path)) offenders.push(`${path} (name)`)
    const bytes = readFileSync(path)
    if (bytes.includes(0)) continue
    const text = withoutProtectedSites(path, bytes.toString('utf8'))
    text.split('\n').forEach((line, index) => {
      // This test's own file name is quoted where files are listed (starter.json, its own checks).
      if (names.test(line.replaceAll('no-manon-data.test.ts', '')))
        offenders.push(`${path}:${index + 1}`)
      for (const candidate of candidates(line))
        if (hashed.has(sha256(candidate))) offenders.push(`${path}:${index + 1} (personal data)`)
    })
  }
  assert.deepEqual(offenders, [])
})

void test('the protected production sites are the only exception, and only in the deploy keys', () => {
  const config = JSON.parse(readFileSync('site.config.json', 'utf8')) as {
    deploy: { protectedHosts: string[]; protectedHealthUrl: string }
  }
  for (const host of config.deploy.protectedHosts) assert.match(host, /^[a-z0-9.-]+$/)
  assert.match(config.deploy.protectedHealthUrl, /^https:\/\/[a-z0-9.-]+\/api\/health$/)
})

void test('the detector itself finds the forbidden values', () => {
  assert.ok(names.test(`${first.toUpperCase()} ${last}`))
  assert.ok(names.test(['M', 'K-2026'].join('')))
  // A SIRET written in groups, as in legal notices, is found from its hash.
  const siret = ['901', '986', '786', '00019'].join(' ')
  assert.ok([...candidates(`SIRET ${siret}.`)].some((value) => hashed.has(sha256(value))))
})
