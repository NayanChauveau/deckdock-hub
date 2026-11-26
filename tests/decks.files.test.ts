import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { after, test } from 'node:test'
import { pack, type Header } from 'tar-stream'
import { blobPath, putBlob } from '../src/modules/decks/adapters/files/blob-store'
import {
  extractEdition,
  ExtractError,
  MAX_EDITION_BYTES,
  MAX_EDITION_FILES,
  MAX_PATH_BYTES,
  MAX_PATH_DEPTH,
  MAX_SEGMENT_BYTES,
  type ExtractErrorCode,
} from '../src/modules/decks/adapters/files/extract'

const roots: string[] = []
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'decks-files-'))
  roots.push(root)
  return root
}

type Member = Partial<Header> & { name: string; body?: string | Buffer }

/** Builds a gzipped tar archive in memory, the way the publishing Action does. */
async function archive(members: Member[]): Promise<Buffer> {
  return gzipSync(await tarball(members))
}

async function tarball(members: Member[]): Promise<Buffer> {
  const tar = pack()
  const chunks: Buffer[] = []
  const done = (async () => {
    for await (const chunk of tar) chunks.push(Buffer.from(chunk as Uint8Array))
  })()
  for (const { body, ...header } of members)
    await new Promise<void>((resolve, reject) =>
      tar.entry(header, body ?? '', (error) => {
        if (error) reject(error)
        else resolve()
      }),
    )
  tar.finalize()
  await done
  return Buffer.concat(chunks)
}

const limits = { maxBytes: 1024 * 1024, maxFiles: 100 }

async function refused(
  members: Member[] | Buffer,
  code: ExtractErrorCode,
  options = limits,
): Promise<string> {
  const dir = await scratch()
  const bytes = Buffer.isBuffer(members) ? members : await archive(members)
  await assert.rejects(extractEdition(Readable.from([bytes]), dir, options), (error) => {
    assert.ok(error instanceof ExtractError, String(error))
    assert.equal(error.code, code, error.message)
    assert.ok(error.message.length > 0)
    return true
  })
  return dir
}

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort()
}

void test('the default limits match the publishing contract', () => {
  assert.equal(MAX_EDITION_BYTES, 524288000)
  assert.equal(MAX_EDITION_FILES, 20000)
})

void test('extracts a valid edition', async () => {
  const dir = await scratch()
  const bytes = await archive([
    { name: 'deck.json', body: '{"name":"Deck"}' },
    { name: 'media', type: 'directory' },
    { name: 'media/a.png', body: Buffer.from([1, 2, 3]) },
    { name: './media/b.mp3', body: 'sound' },
    { name: 'media/é ü.jpg', body: 'unicode' },
  ])
  await extractEdition(Readable.from([bytes]), dir, limits)
  assert.deepEqual(await filesUnder(dir), [
    'deck.json',
    'media/a.png',
    'media/b.mp3',
    'media/é ü.jpg',
  ])
  assert.equal(await readFile(join(dir, 'deck.json'), 'utf8'), '{"name":"Deck"}')
  assert.deepEqual([...(await readFile(join(dir, 'media/a.png')))], [1, 2, 3])
})

void test('rejects parent traversal', async () => {
  const root = await scratch()
  const dir = join(root, 'edition')
  await mkdir(dir)
  for (const name of ['../evil.txt', 'media/../../evil.txt', 'media/..', './../evil.txt']) {
    await assert.rejects(
      extractEdition(Readable.from([await archive([{ name, body: 'x' }])]), dir, limits),
      (error) => error instanceof ExtractError && error.code === 'unsafe_path',
      name,
    )
  }
  assert.deepEqual(await readdir(root), ['edition'])
})

void test('rejects absolute paths', async () => {
  await refused([{ name: '/etc/evil', body: 'x' }], 'unsafe_path')
  await refused([{ name: '/media', type: 'directory' }], 'unsafe_path')
})

void test('rejects unusual names: backslash, empty segments, duplicates', async () => {
  await refused([{ name: 'media\\a.png', body: 'x' }], 'unsafe_path')
  await refused([{ name: 'media//a.png', body: 'x' }], 'unsafe_path')
  await refused([{ name: 'media/./a.png', body: 'x' }], 'unsafe_path')
  await refused(
    [
      { name: 'deck.json', body: 'a' },
      { name: './deck.json', body: 'b' },
    ],
    'duplicate_path',
  )
  await refused(
    [
      { name: 'media', body: 'a file' },
      { name: 'media/a.png', body: 'x' },
    ],
    'duplicate_path',
  )
})

void test('rejects over-long names without revealing the server path', async () => {
  for (const name of [
    `media/${'a'.repeat(300)}`,
    `media/${'é'.repeat(128)}`, // 256 UTF-8 bytes
    Array.from({ length: 6 }, () => 'b'.repeat(200)).join('/'),
    Array.from({ length: MAX_PATH_DEPTH + 1 }, () => 'd').join('/'),
  ]) {
    const dir = await scratch()
    const bytes = await archive([{ name, body: 'x' }])
    await assert.rejects(extractEdition(Readable.from([bytes]), dir, limits), (error) => {
      assert.ok(error instanceof ExtractError, String(error))
      assert.equal(error.code, 'unsafe_path', error.message)
      assert.ok(!error.message.includes(dir), error.message)
      assert.ok(!error.message.includes(tmpdir()), error.message)
      assert.ok(error.message.length < 300, error.message)
      return true
    })
  }
  const longest = await scratch()
  const name = `media/${'c'.repeat(MAX_SEGMENT_BYTES)}`
  await extractEdition(Readable.from([await archive([{ name, body: 'x' }])]), longest, limits)
  assert.deepEqual(await filesUnder(longest), [name])
  assert.equal(MAX_PATH_BYTES, 1024)
})

void test('rejects paths that collide ignoring case or Unicode form', async () => {
  await refused(
    [
      { name: 'Deck.json', body: 'a' },
      { name: 'deck.json', body: 'b' },
    ],
    'duplicate_path',
  )
  await refused(
    [
      { name: 'media/caf\u00e9.png', body: 'nfc' },
      { name: 'media/cafe\u0301.png', body: 'nfd' },
    ],
    'duplicate_path',
  )
  // Parent directories too: Media/ and media/ would merge on a case-insensitive filesystem.
  await refused(
    [
      { name: 'Media/a.png', body: 'a' },
      { name: 'media/b.png', body: 'b' },
    ],
    'duplicate_path',
  )
  await refused(
    [
      { name: 'media', type: 'directory' },
      { name: 'MEDIA', type: 'directory' },
    ],
    'duplicate_path',
  )
  // The same directory, implied then listed, is fine.
  const dir = await scratch()
  const bytes = await archive([
    { name: 'media/a.png', body: 'a' },
    { name: 'media', type: 'directory' },
    { name: 'media/b.png', body: 'b' },
  ])
  await extractEdition(Readable.from([bytes]), dir, limits)
  assert.deepEqual(await filesUnder(dir), ['media/a.png', 'media/b.png'])
})

void test('the stream meter stops a flood of empty tar records', async () => {
  // Zero blocks carry no member, so only the meter on the decompressed stream can stop them.
  const flood = gzipSync(Buffer.alloc(8 * 1024 * 1024))
  assert.ok(flood.length < 64 * 1024)
  const dir = await refused(flood, 'too_large', { maxBytes: 1, maxFiles: 1 })
  assert.deepEqual(await filesUnder(dir), [])
})

void test('rejects names that are not valid UTF-8', async () => {
  const tar = await tarball([{ name: 'media/XX.png', body: 'x' }])
  const at = tar.indexOf('XX')
  tar[at] = 0xff
  tar[at + 1] = 0xfe
  // Recompute the header checksum: the sum of the header bytes, its own field counted as spaces.
  tar.fill(0x20, 148, 156)
  let sum = 0
  for (let i = 0; i < 512; i++) sum += tar[i] ?? 0
  tar.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'latin1')
  await refused(gzipSync(tar), 'unsafe_path')
})

void test('rejects symlinks and hardlinks', async () => {
  const symlink = await refused(
    [{ name: 'media/link', type: 'symlink', linkname: '/etc/passwd' }],
    'unsupported_entry',
  )
  assert.deepEqual(await filesUnder(symlink), [])
  await refused(
    [
      { name: 'deck.json', body: '{}' },
      { name: 'media/hard', type: 'link', linkname: 'deck.json' },
    ],
    'unsupported_entry',
  )
  for (const type of ['character-device', 'block-device', 'fifo'] as const)
    await refused([{ name: 'dev', type }], 'unsupported_entry')
})

void test('rejects too many files', async () => {
  const members = Array.from({ length: 6 }, (_, i) => ({ name: `media/${i}.txt`, body: 'x' }))
  const dir = await refused(members, 'too_many_files', { maxBytes: 1024, maxFiles: 5 })
  assert.ok((await filesUnder(dir)).length <= 5)
  const exact = await scratch()
  await extractEdition(Readable.from([await archive(members.slice(0, 5))]), exact, {
    maxBytes: 1024,
    maxFiles: 5,
  })
  assert.equal((await filesUnder(exact)).length, 5)
})

void test('rejects a decompression bomb before writing it all', async () => {
  const maxBytes = 1024 * 1024
  const chunk = 64 * 1024
  // One big member, then many members that each fit but add up far beyond the limit.
  const single = await archive([{ name: 'media/zeros.bin', body: Buffer.alloc(64 * maxBytes) }])
  assert.ok(single.length < maxBytes / 4, 'the archive itself is small')
  const one = await refused(single, 'too_large', { maxBytes, maxFiles: 100 })
  assert.equal((await filesUnder(one)).length, 0)

  const many = await archive(
    Array.from({ length: 40 }, (_, i) => ({
      name: `media/${i}.bin`,
      body: Buffer.alloc(maxBytes / 4),
    })),
  )
  const dir = await refused(many, 'too_large', { maxBytes, maxFiles: 100 })
  let written = 0
  for (const file of await filesUnder(dir)) written += (await stat(join(dir, file))).size
  assert.ok(written <= maxBytes + chunk, `${written} bytes written`)
})

void test('rejects data that is not a gzipped tar archive', async () => {
  await refused(Buffer.from('not an archive at all'), 'invalid_archive')
  await refused(gzipSync(Buffer.from('x'.repeat(2000))), 'invalid_archive')
  const valid = await archive([{ name: 'deck.json', body: 'x'.repeat(4000) }])
  await refused(valid.subarray(0, valid.length - 20), 'invalid_archive')
})

void test('putBlob is idempotent and content-addressed', async () => {
  const dataDir = await scratch()
  const source = join(dataDir, 'source.bin')
  const content = Buffer.from('some media bytes')
  await writeFile(source, content)
  const sha256 = createHash('sha256').update(content).digest('hex')

  const first = await putBlob(dataDir, source)
  assert.deepEqual(first, { sha256, size: content.length })
  const path = blobPath(dataDir, sha256)
  assert.equal(path, join(dataDir, 'blobs', sha256.slice(0, 2), sha256))
  assert.deepEqual(await readFile(path), content)
  assert.equal((await stat(path)).mode & 0o777, 0o444)
  const before = await stat(path)

  const copy = join(dataDir, 'copy.bin')
  await writeFile(copy, content)
  assert.deepEqual(await putBlob(dataDir, copy), first)
  const afterwards = await stat(path)
  assert.equal(afterwards.ino, before.ino, 'the existing blob is kept, not rewritten')
  assert.deepEqual(await readdir(join(dataDir, 'tmp')), [], 'no temporary file is left')
  assert.deepEqual(await readdir(join(dataDir, 'blobs', sha256.slice(0, 2))), [sha256])

  assert.throws(() => blobPath(dataDir, '../../etc/passwd'))
  assert.throws(() => blobPath(dataDir, sha256.toUpperCase()))
})
