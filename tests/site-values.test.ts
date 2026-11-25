import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { repositoryFiles } from '../scripts/repository-files.mjs'
import { isAllowed, siteValueOffenders } from '../scripts/site-values.mjs'
import { site } from '../src/core/site'

// Values come from the configuration, so the same test protects any site made from this one. The
// matching and the allow-list live in scripts/site-values.mjs, shared with scripts/init-site.mjs.

/** Every file of the repository is scanned, except the allow-list of scripts/site-values.mjs. */
export const scanned: RegExp[] = [/./]

const files = repositoryFiles()

void test('no per-site value is written outside the site configuration', () => {
  const entries = files
    .filter((path) => scanned.some((pattern) => pattern.test(path)) && !isAllowed(path))
    .map((path): [string, string] => [path, readFileSync(path, 'utf8')])
  const offenders = siteValueOffenders(site, entries).map(
    ({ path, line, value }) => `${path}:${line} (${value})`,
  )
  assert.deepEqual(offenders, [])
})

void test('per-site values are matched as whole words, case-insensitively', () => {
  const config = {
    ...site,
    slug: 'essai-bleu',
    identity: { ...site.identity, displayName: 'Atelier Essai', domain: 'essai.fr' },
    app: { ...site.app, port: 3400 },
    deploy: { ...site.deploy, directory: '/srv/essai-bleu', defaultHost: 'essai.fr' },
  }
  const found = (line: string) =>
    siteValueOffenders(config, [['a.ts', line]]).map((hit) => hit.value)
  // Generic words that merely contain a value: « nécessaire », « réessayer », a longer number.
  assert.deepEqual(found('Paiement nécessaire ; réessayer ; 34000 ; atelier essaim'), [])
  assert.deepEqual(found("const name = 'essai'"), ['essai'])
  assert.deepEqual(found('ESSAI-BLEU_prod'), ['essai-bleu', 'essai'])
  assert.deepEqual(found('Bienvenue chez Atelier essai'), ['essai', 'Atelier Essai'])
  assert.deepEqual(found('https://www.essai.fr/x'), ['essai', 'essai.fr'])
  assert.deepEqual(found('port: 3400,'), ['3400'])
  const measured = {
    ...config,
    analytics: {
      host: 'https://stats.essai.test',
      websiteId: '3f1c2a4e-8b7d-4c6e-9a5f-1e2d3c4b5a69',
    },
  }
  assert.deepEqual(
    siteValueOffenders(measured, [['a.ts', "id: '3f1c2a4e-8b7d-4c6e-9a5f-1e2d3c4b5a69'"]]).map(
      (hit) => hit.value,
    ),
    ['3f1c2a4e-8b7d-4c6e-9a5f-1e2d3c4b5a69'],
  )
})

void test('client components never import the site configuration', () => {
  const clientImporters = files.filter(
    (path) =>
      /^src\/.*\.tsx$/.test(path) &&
      /^['"]use client['"]/.test(readFileSync(path, 'utf8')) &&
      /from ['"][^'"]*core\/site['"]/.test(readFileSync(path, 'utf8')),
  )
  assert.deepEqual(clientImporters, [])
})
