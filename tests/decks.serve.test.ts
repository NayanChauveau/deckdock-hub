import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  serveDeckFile,
  type ServeDeps,
  type ServeStore,
} from '../src/modules/decks/application/serve'
import {
  editionAddress,
  indexText,
  parseServePath,
  servePath,
} from '../src/modules/decks/domain/serving'
import {
  contentDisposition,
  etagMatches,
  mediaType,
} from '../src/modules/decks/adapters/http/serve-headers'

const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
const sha = (c: string) => c.repeat(64)

void test('index.json: deckdock-index/1, sorted by edition code point, as make_index.py writes it', () => {
  const text = indexText([
    { edition: 'fr', name: 'Verbes', language: ['fr'], version: 'v2' },
    { edition: 'en', name: 'Verbs "é"', language: ['en', 'fr'], version: 'v1' },
    // U+1F600 (a surrogate pair in UTF-16) sorts after U+FF5E by code point, not by code unit.
    { edition: '\u{1F600}', name: 'a', language: ['x'], version: '1' },
    { edition: '～', name: 'b', language: ['x'], version: '1' },
  ])
  assert.ok(text.endsWith('}\n'))
  const parsed = JSON.parse(text) as { format: string; editions: { edition: string }[] }
  assert.equal(parsed.format, 'deckdock-index/1')
  assert.deepEqual(
    parsed.editions.map((entry) => entry.edition),
    ['en', 'fr', '～', '\u{1F600}'],
  )
  // Python's json.dumps(..., ensure_ascii=False, indent=2) + "\n": two-space indent, ": ".
  assert.ok(text.startsWith('{\n  "format": "deckdock-index/1",\n  "editions": [\n    {\n'))
  assert.ok(text.includes('"name": "Verbs \\"é\\""'))
  assert.equal(indexText([]), '{\n  "format": "deckdock-index/1",\n  "editions": []\n}\n')
  // Key order of each entry: edition, name, language, version.
  assert.deepEqual(Object.keys(present0(parsed.editions)), [
    'edition',
    'name',
    'language',
    'version',
  ])
})
const present0 = <T>(items: T[]): T => {
  assert.ok(items[0])
  return items[0]
}

void test('serve paths: index, deck.json and one media file, nothing else', () => {
  assert.deepEqual(parseServePath(['index.json']), { kind: 'index' })
  assert.deepEqual(parseServePath(['en', 'deck.json']), { kind: 'deck', edition: 'en' })
  assert.deepEqual(parseServePath(['en', 'media', 'a b.png']), {
    kind: 'media',
    edition: 'en',
    filename: 'a b.png',
  })
  for (const path of [
    [],
    ['deck.json'],
    ['en'],
    ['en', 'index.json'],
    ['en', 'media'],
    ['en', 'media', ''],
    ['en', 'media', '..'],
    ['en', 'media', '.'],
    ['en', 'media', 'a/b.png'],
    ['en', 'media', 'a\\b.png'],
    ['en', 'media', 'a.png', 'x'],
    ['..', 'deck.json'],
    ['', 'deck.json'],
    ['a/b', 'deck.json'],
  ])
    assert.equal(parseServePath(path), null, JSON.stringify(path))
})

void test('addresses: <origin>/d/<handle>/<deck>/<edition>/ with each segment percent-encoded', () => {
  assert.equal(
    editionAddress('https://hub.example', 'alice', 'verbs', 'en'),
    'https://hub.example/d/alice/verbs/en/',
  )
  assert.equal(
    servePath('alice', 'verbs', 'en', 'media', "it's a (b)*.png"),
    '/d/alice/verbs/en/media/it%27s%20a%20%28b%29%2A.png',
  )
  assert.equal(servePath('alice', 'verbs', 'index.json'), '/d/alice/verbs/index.json')
})

void test('media types: a fixed allowlist, never text/html', () => {
  assert.equal(mediaType('a.png'), 'image/png')
  assert.equal(mediaType('A.PNG'), 'image/png')
  assert.equal(mediaType('a.jpeg'), 'image/jpeg')
  assert.equal(mediaType('x.svg'), 'image/svg+xml')
  assert.equal(mediaType('s.mp3'), 'audio/mpeg')
  assert.equal(mediaType('v.webm'), 'video/webm')
  assert.equal(mediaType('f.woff2'), 'font/woff2')
  assert.equal(mediaType('_style.css'), 'text/css; charset=utf-8')
  assert.equal(mediaType('n.txt'), 'text/plain; charset=utf-8')
  for (const name of ['page.html', 'page.htm', 'p.xhtml', 'x.xml', 'a.js', 'noext', '.png', 'a.'])
    assert.equal(mediaType(name), 'application/octet-stream', name)
})

void test('ETag comparison for If-None-Match: list, *, weak, nothing else', () => {
  const etag = `"${sha('a')}"`
  assert.equal(etagMatches(etag, etag), true)
  assert.equal(etagMatches(`"x", ${etag}`, etag), true)
  assert.equal(etagMatches(`"x",${etag} , "y"`, etag), true)
  assert.equal(etagMatches('*', etag), true)
  assert.equal(etagMatches(`W/${etag}`, etag), true)
  assert.equal(etagMatches(`"${sha('b')}"`, etag), false)
  assert.equal(etagMatches(sha('a'), etag), false)
  assert.equal(etagMatches('', etag), false)
  assert.equal(etagMatches(null, etag), false)
})

void test('Content-Disposition: inline, RFC 5987 filename', () => {
  assert.equal(contentDisposition('a.png'), "inline; filename*=UTF-8''a.png")
  assert.equal(contentDisposition('a b é.svg'), "inline; filename*=UTF-8''a%20b%20%C3%A9.svg")
  assert.equal(
    contentDisposition('x\r\n"(1)\'*.png'),
    "inline; filename*=UTF-8''x%0D%0A%22%281%29%27%2A.png",
  )
})

/** A deck `verbs` of `alice`, its editions' latest versions given by `editions`. */
function fakeStore(
  status: 'pending' | 'approved' | 'hidden',
  editions: Record<
    string,
    { version: string; files: Record<string, { sha256: string; size: number }> }
  >,
) {
  const calls: string[] = []
  const store: ServeStore = {
    async deck(handle, deckId) {
      calls.push(`deck:${handle}/${deckId}`)
      return handle === 'alice' && deckId === 'verbs' ? { id: 7, status } : null
    },
    async latestVersions(deck) {
      calls.push(`latest:${deck}`)
      return Object.entries(editions).map(([edition, latest]) => ({
        edition,
        name: `Verbs ${edition}`,
        language: [edition],
        version: latest.version,
      }))
    },
    // One key at a time, as the Postgres adapter reads it (`files -> key`): never the map.
    async latestFile(deck, edition, key) {
      calls.push(`file:${deck}/${edition}/${key}`)
      const map = editions[edition]?.files
      return map && Object.hasOwn(map, key) ? (map[key] ?? null) : null
    },
  }
  return { store, calls }
}
const files = {
  'deck.json': { sha256: sha('d'), size: 120 },
  'media/a b.png': { sha256: sha('m'), size: 9 },
}
const deps = (store: ServeStore): ServeDeps => ({ store, hash })

void test('serving: index.json with its hash, deck.json and media by their stored digest', async () => {
  const { store, calls } = fakeStore('approved', {
    fr: { version: 'v2', files },
    en: { version: 'v1', files },
  })
  const index = await serveDeckFile(deps(store), {
    handle: 'alice',
    deckId: 'verbs',
    path: ['index.json'],
  })
  assert.ok(index.kind === 'text')
  assert.equal(index.noindex, false)
  assert.equal(index.sha256, hash(index.text))
  assert.deepEqual(
    (JSON.parse(index.text) as { editions: { edition: string }[] }).editions.map((e) => e.edition),
    ['en', 'fr'],
  )

  const deck = await serveDeckFile(deps(store), {
    handle: 'alice',
    deckId: 'verbs',
    path: ['en', 'deck.json'],
  })
  assert.deepEqual(deck, {
    kind: 'blob',
    file: 'deck',
    filename: 'deck.json',
    sha256: sha('d'),
    size: 120,
    noindex: false,
  })
  const media = await serveDeckFile(deps(store), {
    handle: 'alice',
    deckId: 'verbs',
    path: ['en', 'media', 'a b.png'],
  })
  assert.deepEqual(media, {
    kind: 'blob',
    file: 'media',
    filename: 'a b.png',
    sha256: sha('m'),
    size: 9,
    noindex: false,
  })
  // deck.json and the media file were each asked for by their own key.
  assert.deepEqual(
    calls.filter((call) => call.startsWith('file:')),
    ['file:7/en/deck.json', 'file:7/en/media/a b.png'],
  )
})

void test('serving: pending is noindex, hidden is gone, anything unknown is missing', async () => {
  const pending = fakeStore('pending', { en: { version: 'v1', files } })
  const index = await serveDeckFile(deps(pending.store), {
    handle: 'alice',
    deckId: 'verbs',
    path: ['index.json'],
  })
  assert.equal(index.kind === 'text' && index.noindex, true)

  const hidden = fakeStore('hidden', { en: { version: 'v1', files } })
  for (const path of [['index.json'], ['en', 'deck.json'], ['en', 'media', 'a b.png']])
    assert.deepEqual(
      await serveDeckFile(deps(hidden.store), { handle: 'alice', deckId: 'verbs', path }),
      { kind: 'gone' },
    )

  const { store, calls } = fakeStore('approved', { en: { version: 'v1', files } })
  for (const [handle, deckId, path] of [
    ['bob', 'verbs', ['index.json']],
    ['alice', 'nouns', ['index.json']],
    ['alice', 'verbs', ['fr', 'deck.json']],
    ['alice', 'verbs', ['en', 'media', 'missing.png']],
    ['alice', 'verbs', ['en', 'media', '__proto__']],
    ['alice', 'verbs', ['en', 'media', 'constructor']],
    ['alice', 'verbs', ['en', 'media', 'deck.json']],
  ] as const)
    assert.deepEqual(
      await serveDeckFile(deps(store), { handle, deckId, path: [...path] }),
      { kind: 'missing' },
      `${handle}/${deckId}/${path.join('/')}`,
    )

  // Malformed names never reach the store.
  calls.length = 0
  for (const [handle, deckId, path] of [
    ['Alice', 'verbs', ['index.json']],
    [' alice', 'verbs', ['index.json']],
    ['alice', 'Verbs', ['index.json']],
    ['alice', 'verbs', ['en', 'other.json']],
    ['alice', 'verbs', ['en', 'media', '..']],
  ] as const)
    assert.deepEqual(await serveDeckFile(deps(store), { handle, deckId, path: [...path] }), {
      kind: 'missing',
    })
  assert.deepEqual(calls, [])
})

void test('serving: a deck with no published edition has an empty index', async () => {
  const { store } = fakeStore('pending', {})
  const index = await serveDeckFile(deps(store), {
    handle: 'alice',
    deckId: 'verbs',
    path: ['index.json'],
  })
  assert.ok(index.kind === 'text')
  assert.deepEqual((JSON.parse(index.text) as { editions: unknown[] }).editions, [])
})
