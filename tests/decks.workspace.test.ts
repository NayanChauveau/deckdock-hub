import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { after, test } from 'node:test'
import { blobPath } from '../src/modules/decks/adapters/files/blob-store'
import {
  editionWorkspace,
  MAX_DECK_JSON_BYTES,
  UploadAborted,
  type Upload,
} from '../src/modules/decks/adapters/files/workspace'
import type { CheckIssue, DeckdockChecker } from '../src/modules/decks/adapters/python/checker'
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  hubDataDir,
  maxUploadBytes,
} from '../src/modules/decks/composition'
import { present } from './support/present'
import { archive, deckJson, editionArchive, MEDIA, sha256 } from './support/deck-archive'

const roots: string[] = []
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})
async function dataDir() {
  const root = await mkdtemp(join(tmpdir(), 'decks-workspace-'))
  roots.push(root)
  return root
}

/** Records the dist directory it is given, answers the scripted issues. */
function fakeChecker(issues: (dist: string) => CheckIssue[] = () => []) {
  const seen: { dist?: string; compat?: [string, string] } = {}
  const checker: DeckdockChecker = {
    check: async (dist) => {
      seen.dist = dist
      return issues(dist)
    },
    compat: async (previous, next) => {
      seen.compat = [previous, next]
      return []
    },
  }
  return { checker, seen }
}

const upload = (data: Buffer, declared: number | null = data.length): Upload => ({
  body: Readable.from([data]),
  declaredLength: declared,
})

function workspace(
  dir: string,
  data: Buffer,
  options: { max?: number; declared?: number | null } = {},
) {
  const fake = fakeChecker()
  const ws = editionWorkspace({
    dataDir: dir,
    maxUploadBytes: options.max ?? 1024 * 1024,
    upload: upload(data, options.declared === undefined ? data.length : options.declared),
    checker: fake.checker,
  })
  return { ws, seen: fake.seen }
}

void test('the upload limit comes from HUB_MAX_UPLOAD_BYTES, else site.config.json', () => {
  assert.equal(maxUploadBytes({ HUB_MAX_UPLOAD_BYTES: '2048' }), 2048)
  assert.equal(maxUploadBytes({}), DEFAULT_MAX_UPLOAD_BYTES)
  assert.throws(() => maxUploadBytes({ HUB_MAX_UPLOAD_BYTES: '-1' }))
  assert.throws(() => maxUploadBytes({ HUB_MAX_UPLOAD_BYTES: 'big' }))
})

void test('a valid edition is unpacked under dist/<edition>, hashed, kept, then removed', async () => {
  const dir = await dataDir()
  const deck = deckJson()
  const { ws, seen } = workspace(dir, await editionArchive(deck))
  assert.equal(await ws.receive(), 'ok')
  assert.deepEqual(await ws.unpack('en'), [])
  assert.deepEqual(await ws.check(), [])
  assert.match(seen.dist ?? '', /\/tmp\/publish-[0-9a-f-]+\/dist$/)
  assert.deepEqual(await readdir(seen.dist ?? ''), ['en'])
  assert.deepEqual(await ws.deckJson(), deck)
  const files = await ws.files()
  const text = JSON.stringify(deck)
  assert.deepEqual(files, {
    'deck.json': { sha256: sha256(text), size: Buffer.byteLength(text) },
    'media/a.png': { sha256: sha256(MEDIA), size: MEDIA.length },
  })
  await ws.keep()
  assert.equal(await readFile(blobPath(dir, sha256(MEDIA)), 'utf8'), MEDIA.toString())
  await ws.compat(sha256('previous'))
  assert.equal(present(seen.compat)[0], blobPath(dir, sha256('previous')))
  assert.match(present(seen.compat)[1], /\/dist\/en\/deck\.json$/)
  await ws.dispose()
  assert.deepEqual(await readdir(join(dir, 'tmp')), [])
})

void test('a body over the limit is too large, declared or streamed', async () => {
  const dir = await dataDir()
  const data = Buffer.alloc(4096, 1)
  // Declared: refused before anything is written.
  const declared = workspace(dir, data, { max: 1000 })
  assert.equal(await declared.ws.receive(), 'too_large')
  await declared.ws.dispose()
  // Not declared (chunked): refused while it streams.
  const streamed = workspace(dir, data, { max: 1000, declared: null })
  assert.equal(await streamed.ws.receive(), 'too_large')
  await streamed.ws.dispose()
  // A lying Content-Length does not help.
  const lying = workspace(dir, data, { max: 1000, declared: 10 })
  assert.equal(await lying.ws.receive(), 'too_large')
  await lying.ws.dispose()
  assert.deepEqual(await readdir(join(dir, 'tmp')), [])
})

void test('the layout is deck.json and media/<file>, nothing else', async () => {
  const dir = await dataDir()
  const cases: [Parameters<typeof archive>[0], RegExp][] = [
    [
      [
        { name: 'deck.json', body: '{}' },
        { name: 'notes.txt', body: 'x' },
      ],
      /"notes\.txt"/,
    ],
    [
      [
        { name: 'deck.json', body: '{}' },
        { name: 'media/sub/a.png', body: 'x' },
      ],
      /"media\/sub"/,
    ],
    [[{ name: 'media/a.png', body: 'x' }], /deck\.json is missing/],
    [[{ name: 'deck.json', type: 'directory' }], /"deck\.json"/],
    [[{ name: 'en/deck.json', body: '{}' }], /"en"/],
  ]
  for (const [members, message] of cases) {
    const { ws } = workspace(dir, await archive(members))
    assert.equal(await ws.receive(), 'ok')
    const issues = await ws.unpack('en')
    assert.ok(issues.length > 0, JSON.stringify(members))
    assert.ok(issues.every((issue) => issue.where === 'archive'))
    assert.ok(
      issues.some((issue) => message.test(issue.message)),
      JSON.stringify(issues),
    )
    await ws.dispose()
  }
  assert.deepEqual(await readdir(join(dir, 'tmp')), [])
})

void test('an unsafe or broken archive gives the extraction message, no server path', async () => {
  const dir = await dataDir()
  for (const data of [
    await archive([{ name: '../evil', body: 'x' }]),
    await archive([{ name: 'deck.json', type: 'symlink', linkname: '/etc/passwd' }]),
    Buffer.from('not an archive'),
  ]) {
    const { ws } = workspace(dir, data)
    await ws.receive()
    const issues = await ws.unpack('en')
    assert.equal(issues.length, 1)
    assert.equal(issues[0]?.where, 'archive')
    assert.ok(!present(issues[0]).message.includes(dir))
    await ws.dispose()
  }
})

void test('the edition directory is named after deck.edition, so a mismatch reaches step 6', async () => {
  const dir = await dataDir()
  const { ws, seen } = workspace(dir, await editionArchive(deckJson({ edition: 'fr' })))
  await ws.receive()
  assert.deepEqual(await ws.unpack('en'), [])
  await ws.check()
  assert.deepEqual(await readdir(seen.dist ?? ''), ['fr'])
  await ws.dispose()
  // Unusable deck.edition, or unreadable deck.json: the URL's edition.
  for (const body of [JSON.stringify(deckJson({ edition: '../x' })), '{not json']) {
    const other = workspace(dir, await archive([{ name: 'deck.json', body }]))
    await other.ws.receive()
    assert.deepEqual(await other.ws.unpack('en'), [])
    await other.ws.check()
    assert.deepEqual(await readdir(other.seen.dist ?? ''), ['en'])
    await other.ws.dispose()
  }
})

void test('checker issues are shown without the workspace path, with their line, at most 100', async () => {
  const dir = await dataDir()
  const fake = fakeChecker((dist) => [
    { path: 'dist/en/deck.json', where: 'notes[0]', message: "missing key 'guid'", line: null },
    { path: 'dist/en/deck.json', where: '', message: `cannot read ${dist}/en/deck.json`, line: 3 },
    ...Array.from({ length: 120 }, (_, i) => ({
      path: 'x',
      where: `notes[${i}]`,
      message: 'bad',
      line: null,
    })),
  ])
  const ws = editionWorkspace({
    dataDir: dir,
    maxUploadBytes: 1024 * 1024,
    upload: upload(await editionArchive(deckJson())),
    checker: fake.checker,
  })
  await ws.receive()
  await ws.unpack('en')
  const issues = await ws.check()
  assert.deepEqual(issues[0], { where: 'notes[0]', message: "missing key 'guid'" })
  assert.deepEqual(issues[1], { where: 'deck.json', message: 'cannot read en/deck.json (line 3)' })
  assert.equal(issues.length, 101)
  assert.match(issues.at(-1)?.message ?? '', /and 22 more errors/)
  await ws.dispose()
})

void test('HUB_DATA_DIR is made absolute', () => {
  assert.equal(hubDataDir({ HUB_DATA_DIR: 'storage/hub' }), join(process.cwd(), 'storage/hub'))
  assert.throws(() => hubDataDir({}))
})

void test('a deck.json over the limit is refused before it is read', async () => {
  assert.equal(MAX_DECK_JSON_BYTES, 52_428_800)
  const dir = await dataDir()
  const body = JSON.stringify(deckJson())
  const ws = editionWorkspace({
    dataDir: dir,
    maxUploadBytes: 1024 * 1024,
    upload: upload(await editionArchive(deckJson())),
    checker: fakeChecker().checker,
    maxDeckJsonBytes: Buffer.byteLength(body) - 1,
  })
  await ws.receive()
  const issues = await ws.unpack('en')
  assert.equal(issues.length, 1)
  assert.equal(issues[0]?.where, 'deck.json')
  assert.match(present(issues[0]).message, /at most/)
  await ws.dispose()
  assert.deepEqual(await readdir(join(dir, 'tmp')), [])
})

void test('a body the client stops sending is an aborted upload, and is cleaned up', async () => {
  const dir = await dataDir()
  const body = new Readable({ read: () => undefined })
  body.on('error', () => undefined) // as the route does
  body.push(Buffer.alloc(1000, 1))
  setImmediate(() => body.destroy(Object.assign(new Error('aborted'), { code: 'ECONNRESET' })))
  const ws = editionWorkspace({
    dataDir: dir,
    maxUploadBytes: 1024 * 1024,
    upload: { body, declaredLength: null },
    checker: fakeChecker().checker,
  })
  await assert.rejects(ws.receive(), (error: unknown) => {
    assert.ok(error instanceof UploadAborted)
    assert.equal(error.code, 'ECONNRESET')
    return true
  })
  await ws.dispose()
  assert.deepEqual(await readdir(join(dir, 'tmp')), [])
})

function webBody() {
  const body = Readable.fromWeb(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(1024))
      },
    }) as unknown as NodeReadableStream<Uint8Array>,
  )
  body.on('error', () => undefined) // as the route does
  return body
}

void test('a disk that fails while the body is written is a server error, not an abort', async () => {
  const dir = await dataDir()
  const ws = editionWorkspace({
    dataDir: dir,
    maxUploadBytes: 1024 * 1024,
    // A web body (as the route converts it), still sending when the disk fails: the pipeline
    // destroys it with the disk's error, so `body.errored` alone does not tell an abort.
    upload: { body: webBody(), declaredLength: null },
    checker: fakeChecker().checker,
    sink: () =>
      new Writable({
        write(_chunk, _encoding, done) {
          done(Object.assign(new Error('no space left on device'), { code: 'ENOSPC' }))
        },
      }),
  })
  await assert.rejects(ws.receive(), (error: unknown) => {
    assert.ok(!(error instanceof UploadAborted), 'not an abort')
    assert.equal(Reflect.get(Object(error), 'code'), 'ENOSPC')
    return true
  })
  await ws.dispose()
  assert.deepEqual(await readdir(join(dir, 'tmp')), [])
})
