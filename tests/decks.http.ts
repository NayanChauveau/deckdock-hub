import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { blobPath } from '../src/modules/decks/adapters/files/blob-store'
import { chooseHandle, createDeck, revokeToken } from '../src/modules/decks/server'
import { archive, deckJson, editionArchive, MEDIA, sha256 } from './support/deck-archive'
import { present } from './support/present'

// The publish API on the production build (tests/run.mjs: HUB_MAX_UPLOAD_BYTES = 1 MiB, the
// checker from vendor/deckdock). Tokens and archives are made here; the admin's approval goes
// through the Local API (the admin screens come later).
if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Une base isolée finissant par _test est requise.')
const origin = present(process.env['TEST_ORIGIN'])
const dataDir = present(process.env['HUB_DATA_DIR'])
const maxUpload = Number(present(process.env['HUB_MAX_UPLOAD_BYTES']))
const payload = await getPayload({ config })

/** A customer with a handle, and a deck with its token. */
async function author(handle: string, deckId: string) {
  const customer = await payload.create({
    collection: 'customers',
    data: {
      authUserId: randomUUID(),
      email: `${handle}-${randomBytes(3).toString('hex')}@example.test`,
    },
    overrideAccess: true,
  })
  await chooseHandle(payload, customer.id, handle)
  const { deck, token } = await createDeck(payload, customer.id, deckId)
  return { customerId: customer.id, deck, token }
}

interface Answer {
  status: number
  type: string
  text: string
  json: {
    status: string
    version: string
    notes: number
    warnings: string[]
    errors: { where: string; message: string }[]
  }
}

async function publish(
  edition: string,
  body: Buffer | ReadableStream<Uint8Array> | null,
  token: string | null,
): Promise<Answer> {
  const response = await fetch(`${origin}/api/publish/${encodeURIComponent(edition)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/gzip',
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    },
    ...(body === null ? {} : { body, duplex: 'half' }),
  } as RequestInit)
  const text = await response.text()
  const type = response.headers.get('content-type') ?? ''
  assert.match(
    type,
    /^application\/json/,
    `JSON answer (${response.status}): ${text.slice(0, 200)}`,
  )
  assert.equal(response.headers.get('cache-control'), 'private, no-store')
  // Never a stack, a server path or the token.
  assert.ok(!text.includes(dataDir), text)
  assert.ok(!/\bat .+\.(js|ts):\d+/.test(text), text)
  if (token) assert.ok(!text.includes(token), 'token echoed')
  const json = JSON.parse(text) as Answer['json']
  assert.equal(typeof json.version, 'string')
  assert.equal(typeof json.notes, 'number')
  assert.ok(Array.isArray(json.warnings) && Array.isArray(json.errors))
  return { status: response.status, type, text, json }
}

const versionsOf = async (deck: number) => {
  const editions = await payload.find({
    collection: 'editions',
    where: { deck: { equals: deck } },
    overrideAccess: true,
    depth: 0,
  })
  const ids = editions.docs.map((doc) => doc.id)
  return (
    await payload.find({
      collection: 'versions',
      where: { edition: { in: ids } },
      overrideAccess: true,
      depth: 0,
      sort: 'id',
      pagination: false,
    })
  ).docs
}

try {
  const alice = await author('alice', 'verbs')
  const v1 = deckJson({ version: '2026-11-26-v1' })

  // A valid publish of a pending deck: 200, pending review, files stored by content.
  {
    const answer = await publish('en', await editionArchive(v1), alice.token)
    assert.equal(answer.status, 200, answer.text)
    assert.deepEqual(answer.json, {
      status: 'pending_review',
      version: '2026-11-26-v1',
      notes: 1,
      warnings: [],
      errors: [],
    })
    const version = present((await versionsOf(alice.deck.id))[0])
    assert.equal(version.version, '2026-11-26-v1')
    const text = JSON.stringify(v1)
    assert.equal(version.deckJsonSha256, sha256(text))
    assert.deepEqual(version.files, {
      'deck.json': { sha256: sha256(text), size: Buffer.byteLength(text) },
      'media/a.png': { sha256: sha256(MEDIA), size: MEDIA.length },
    })
    assert.ok(existsSync(blobPath(dataDir, sha256(text))))
    assert.ok(existsSync(blobPath(dataDir, sha256(MEDIA))))
    const edition = (
      await payload.find({
        collection: 'editions',
        where: { deck: { equals: alice.deck.id } },
        overrideAccess: true,
        depth: 0,
      })
    ).docs[0]
    assert.ok(edition)
    assert.equal(edition.code, 'en')
    assert.equal(edition.latestVersion, version.id)
  }

  // The same version and content again (a re-run of CI): already published, nothing created.
  {
    const answer = await publish('en', await editionArchive(v1), alice.token)
    assert.equal(answer.status, 200, answer.text)
    assert.equal(answer.json.status, 'already_published')
    assert.equal(answer.json.version, '2026-11-26-v1')
    assert.equal((await versionsOf(alice.deck.id)).length, 1)
  }

  // The same version with other content: 409.
  {
    const changed = deckJson({ version: '2026-11-26-v1', note: { tags: ['changed'] } })
    const answer = await publish('en', await editionArchive(changed), alice.token)
    assert.equal(answer.status, 409, answer.text)
    assert.equal(answer.json.status, 'rejected')
    assert.match(present(answer.json.errors[0]).message, /already exists with different content/)
    assert.equal((await versionsOf(alice.deck.id)).length, 1)
  }

  // An administrator approves the deck: the next version is published.
  {
    await payload.update({
      collection: 'decks',
      id: alice.deck.id,
      data: { status: 'approved' },
      overrideAccess: true,
    })
    const answer = await publish(
      'en',
      await editionArchive(deckJson({ version: '2026-11-26-v2' })),
      alice.token,
    )
    assert.equal(answer.status, 200, answer.text)
    assert.equal(answer.json.status, 'published')
  }

  // A field added at the end: published, with a warning.
  {
    const answer = await publish(
      'en',
      await editionArchive(
        deckJson({ version: '2026-11-26-v3', fields: ['Front', 'Back', 'Extra'] }),
      ),
      alice.token,
    )
    assert.equal(answer.status, 200, answer.text)
    assert.equal(answer.json.status, 'published')
    assert.equal(answer.json.warnings.length, 1)
    assert.match(answer.json.warnings[0] ?? '', /basic.*Extra.*full sync/)
  }

  // A field removed from a notetype: 409, with the rule.
  {
    const answer = await publish(
      'en',
      await editionArchive(deckJson({ version: '2026-11-26-v4', fields: ['Front', 'Back'] })),
      alice.token,
    )
    assert.equal(answer.status, 409, answer.text)
    assert.equal(answer.json.errors[0]?.where, 'notetypes: basic')
    assert.match(present(answer.json.errors[0]).message, /create a new notetype/)
    assert.deepEqual(
      (await versionsOf(alice.deck.id)).map((version) => version.version),
      ['2026-11-26-v1', '2026-11-26-v2', '2026-11-26-v3'],
    )
  }

  // Two simultaneous publishes of the same new version: one row, both succeed.
  {
    const body = await editionArchive(
      deckJson({ version: '2026-11-26-v5', fields: ['Front', 'Back', 'Extra'] }),
    )
    const answers = await Promise.all([
      publish('en', body, alice.token),
      publish('en', body, alice.token),
    ])
    assert.deepEqual(
      answers.map((answer) => answer.status),
      [200, 200],
      answers.map((answer) => answer.text).join('\n'),
    )
    assert.deepEqual(answers.map((answer) => answer.json.status).sort(), [
      'already_published',
      'published',
    ])
    assert.equal(
      (await versionsOf(alice.deck.id)).filter((version) => version.version === '2026-11-26-v5')
        .length,
      1,
    )
  }

  // Refusals, on another deck (its own rate limit window).
  const bob = await author('bob', 'nouns')
  const nouns = (options: Parameters<typeof deckJson>[0] = {}) =>
    deckJson({ id: 'nouns', ...options })

  // A wrong token, no token, a revoked token: 401.
  {
    for (const token of [`ddk_${'A'.repeat(43)}`, 'not-a-token', null]) {
      const answer = await publish('en', await editionArchive(nouns()), token)
      assert.equal(answer.status, 401, answer.text)
      assert.equal(answer.json.errors[0]?.where, 'token')
    }
    const carol = await author('carol', 'idioms')
    await revokeToken(payload, carol.customerId, 'idioms')
    const answer = await publish(
      'en',
      await editionArchive(deckJson({ id: 'idioms' })),
      carol.token,
    )
    assert.equal(answer.status, 401, answer.text)
  }

  // Trapped archives: 422.
  {
    for (const body of [
      await archive([{ name: '../evil.txt', body: 'x' }]),
      await archive([{ name: 'deck.json', type: 'symlink', linkname: '/etc/passwd' }]),
      await editionArchive(nouns(), [{ name: 'run.sh', body: 'echo' }]),
      Buffer.from('this is not a tar.gz'),
    ]) {
      const answer = await publish('en', body, bob.token)
      assert.equal(answer.status, 422, answer.text)
      assert.equal(answer.json.errors[0]?.where, 'archive')
    }
  }

  // An invalid deck.json: 422, each error with where it is.
  {
    const broken = nouns({ note: { guid: undefined, tags: ['two words'] } })
    const answer = await publish('en', await editionArchive(broken), bob.token)
    assert.equal(answer.status, 422, answer.text)
    assert.ok(answer.json.errors.length >= 2, answer.text)
    assert.ok(
      answer.json.errors.some((error) => error.where.startsWith('notes[0]')),
      answer.text,
    )
    assert.ok(answer.json.errors.every((error) => error.message.length > 0))
  }

  // Another deck's id with this token (point 3): 409. Another edition than the URL's: 409.
  {
    const answer = await publish('en', await editionArchive(deckJson()), bob.token)
    assert.equal(answer.status, 409, answer.text)
    assert.equal(answer.json.errors[0]?.where, 'deck.id')
    assert.equal((await versionsOf(alice.deck.id)).length, 4)
    const other = await publish('fr', await editionArchive(nouns()), bob.token)
    assert.equal(other.status, 409, other.text)
    assert.equal(other.json.errors[0]?.where, 'deck.edition')
  }

  // "dev": 422.
  {
    const answer = await publish('en', await editionArchive(nouns({ version: 'dev' })), bob.token)
    assert.equal(answer.status, 422, answer.text)
    assert.equal(answer.json.errors[0]?.where, 'deck.version')
  }

  // A body over HUB_MAX_UPLOAD_BYTES: 413, declared or streamed without a length.
  {
    const big = randomBytes(maxUpload + 1)
    const declared = await publish('en', big, bob.token)
    assert.equal(declared.status, 413, declared.text)
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let at = 0; at < big.length; at += 64 * 1024)
          controller.enqueue(new Uint8Array(big.subarray(at, at + 64 * 1024)))
        controller.close()
      },
    })
    const chunked = await publish('en', streamed, bob.token)
    assert.equal(chunked.status, 413, chunked.text)
  }
  assert.equal((await versionsOf(bob.deck.id)).length, 0)

  // A hidden deck: 410.
  {
    const dave = await author('dave', 'phrases')
    await payload.update({
      collection: 'decks',
      id: dave.deck.id,
      data: { status: 'hidden', hiddenReason: 'test' },
      overrideAccess: true,
    })
    const answer = await publish(
      'en',
      await editionArchive(deckJson({ id: 'phrases' })),
      dave.token,
    )
    assert.equal(answer.status, 410, answer.text)
  }

  // Every temporary directory is gone, success or refusal.
  assert.deepEqual(await readdir(`${dataDir}/tmp`), [])
  console.log(
    'Publication : jetons, archives, vérificateur, versions, concurrence, 401/409/410/413/422.',
  )
} finally {
  await payload.destroy()
}
