import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { makeSignature } from 'better-auth/crypto'
import { getPayload, handleEndpoints } from 'payload'
import config from '../src/payload.config'
import { closeAuth, getAuth } from '../src/modules/accounts/server'
import {
  chooseHandle,
  createDeck,
  deckForToken,
  DecksError,
  regenerateToken,
  revokeToken,
} from '../src/modules/decks/server'
import { payloadDecksStore } from '../src/modules/decks/adapters/payload/store'
import { hashToken } from '../src/modules/decks/domain/token'
import type { DeckId } from '../src/modules/decks/domain/handle'
import { present } from './support/present'

// Runs on a database where `payload migrate` applied every migration, payload-totp disabled (an
// administrator acts through the Local API without a browser session).
const connectionString = process.env['DATABASE_URL'] || ''
if (!new URL(connectionString).pathname.endsWith('_test'))
  throw new Error('Base isolée _test requise.')
const appURL = present(process.env['APP_URL'])
const payload = await getPayload({ config })

const field = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined

/** Payload's REST API in process, exactly as the Next.js route calls it. */
async function api(path: string, call: { cookie?: string; method?: string; body?: unknown } = {}) {
  const headers = new Headers({ origin: appURL, 'sec-fetch-site': 'same-origin' })
  if (call.cookie) headers.set('cookie', call.cookie)
  if (call.body !== undefined) headers.set('content-type', 'application/json')
  const response = await handleEndpoints({
    config,
    request: new Request(`${appURL}/api${path}`, {
      method: call.method ?? 'GET',
      headers,
      ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
    }),
  })
  const json: unknown = await response.json()
  return { status: response.status, json }
}

/** A signed-in visitor: a Better Auth session and its `customers` document. */
async function visitor() {
  const context = await getAuth().$context
  const email = `author-${randomBytes(4).toString('hex')}@example.test`
  const user = await context.internalAdapter.createUser(
    { email, name: '', emailVerified: true },
    { method: 'magic-link' },
  )
  const session = await context.internalAdapter.createSession(user.id)
  const signature = await makeSignature(session.token, context.secret)
  const cookie = `${context.authCookies.sessionToken.name}=${session.token}.${signature}`
  const me = field((await api('/customers/me', { cookie })).json, 'user')
  const id = field(me, 'id')
  assert.equal(typeof id, 'number', 'customer created on the first request')
  return { cookie, customerId: Number(id) }
}

const code = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    if (error instanceof DecksError) return error.code
    throw error
  }
  return 'resolved'
}
const docs = (json: unknown): unknown[] => {
  const list = field(json, 'docs')
  return Array.isArray(list) ? list : []
}

try {
  const alice = await visitor()
  const bob = await visitor()

  // Handles: unique across authors, chosen once.
  const aliceAuthor = await chooseHandle(payload, alice.customerId, 'alice')
  assert.equal(await code(chooseHandle(payload, bob.customerId, 'Alice')), 'handle_taken')
  assert.equal(
    await code(chooseHandle(payload, alice.customerId, 'other')),
    'handle_already_chosen',
  )
  await assert.rejects(
    payload.create({ collection: 'authors', data: { handle: 'alice' } }),
    'the database refuses a duplicate handle',
  )
  const bobAuthor = await chooseHandle(payload, bob.customerId, 'bob')

  // deckId: unique per author, shared across authors.
  const { deck: aliceDeck, token: aliceToken } = await createDeck(
    payload,
    alice.customerId,
    'verbs',
  )
  assert.equal(aliceDeck.status, 'pending')
  assert.equal(await code(createDeck(payload, alice.customerId, 'verbs')), 'deck_exists')
  const store = payloadDecksStore(payload)
  assert.equal(
    await code(store.createDeck(aliceAuthor.id, 'verbs' as DeckId, hashToken('ddk_other'))),
    'deck_exists',
    'the database index, not only the use case, refuses the duplicate',
  )
  const { deck: bobDeck, token: bobToken } = await createDeck(payload, bob.customerId, 'verbs')
  assert.notEqual(bobDeck.id, aliceDeck.id)
  assert.equal(bobDeck.authorId, bobAuthor.id)

  // Tokens: found by hash, last use recorded, regenerated, revoked.
  const found = present(await deckForToken(payload, aliceToken))
  assert.equal(found.id, aliceDeck.id)
  const stored = await payload.findByID({ collection: 'decks', id: aliceDeck.id, depth: 0 })
  assert.ok(stored.tokenLastUsedAt, 'tokenLastUsedAt recorded')
  assert.equal(stored.tokenHash, hashToken(aliceToken))
  assert.ok(!JSON.stringify(stored).includes(aliceToken), 'the token itself is not stored')
  const regenerated = await regenerateToken(payload, alice.customerId, 'verbs')
  assert.equal(await deckForToken(payload, aliceToken), null, 'the old token no longer works')
  assert.equal((await deckForToken(payload, regenerated))?.id, aliceDeck.id)
  assert.equal(await code(regenerateToken(payload, bob.customerId, 'nope')), 'not_found')
  await revokeToken(payload, alice.customerId, 'verbs')
  assert.equal(await deckForToken(payload, regenerated), null, 'a revoked token works no more')
  assert.equal(
    (await payload.findByID({ collection: 'decks', id: aliceDeck.id, depth: 0 })).tokenHash ?? null,
    null,
  )
  assert.equal(await deckForToken(payload, 'ddk_malformed'), null)

  // A visitor reads only their own author and decks, never a token hash.
  const ownDecks = await api('/decks?depth=0', { cookie: alice.cookie })
  assert.equal(ownDecks.status, 200)
  assert.deepEqual(
    docs(ownDecks.json).map((doc) => field(doc, 'id')),
    [aliceDeck.id],
  )
  for (const doc of docs(ownDecks.json)) assert.ok(!('tokenHash' in Object(doc)), 'no tokenHash')
  const bobsDeck = await api(`/decks/${bobDeck.id}`, { cookie: alice.cookie })
  assert.ok([403, 404].includes(bobsDeck.status), `another author's deck: ${bobsDeck.status}`)
  const ownBob = await api(`/decks/${bobDeck.id}?depth=0`, { cookie: bob.cookie })
  assert.equal(ownBob.status, 200)
  assert.equal(field(ownBob.json, 'tokenHash'), undefined, 'never the hash, even for its owner')
  assert.ok(!JSON.stringify(ownBob.json).includes(hashToken(bobToken)))
  const probe = await api(`/decks?where[tokenHash][equals]=${hashToken(bobToken)}`, {
    cookie: bob.cookie,
  })
  assert.ok(probe.status >= 400 || docs(probe.json).length === 0, 'the hash cannot be queried')
  assert.deepEqual(
    docs((await api('/authors', { cookie: alice.cookie })).json).map((doc) => field(doc, 'handle')),
    ['alice'],
  )
  const anonymous = await api('/decks')
  assert.ok(anonymous.status >= 400 || docs(anonymous.json).length === 0, 'nothing for nobody')

  // Writes go through the use cases only.
  for (const [path, body] of [
    ['/authors', { handle: 'mallory', customer: alice.customerId }],
    ['/decks', { author: aliceAuthor.id, deckId: 'sneaky' }],
  ] as const)
    assert.ok((await api(path, { cookie: alice.cookie, method: 'POST', body })).status >= 400, path)
  const statusByOwner = await api(`/decks/${aliceDeck.id}`, {
    cookie: alice.cookie,
    method: 'PATCH',
    body: { status: 'approved' },
  })
  assert.ok(statusByOwner.status >= 400, `owner changing the status: ${statusByOwner.status}`)
  assert.equal(
    (await payload.findByID({ collection: 'decks', id: aliceDeck.id, depth: 0 })).status,
    'pending',
  )

  // A verified administrator reviews: transitions of the domain, approval date recorded.
  const adminDoc = await payload.create({
    collection: 'users',
    data: {
      email: `admin-${randomBytes(4).toString('hex')}@example.test`,
      name: 'Admin',
      role: 'admin',
      password: randomBytes(24).toString('hex'),
    },
  })
  const admin = { ...adminDoc, collection: 'users' as const }
  const approved = await payload.update({
    collection: 'decks',
    id: aliceDeck.id,
    data: { status: 'approved' },
    user: admin,
    overrideAccess: false,
  })
  assert.equal(approved.status, 'approved')
  assert.ok(approved.approvedAt, 'approval date recorded')
  assert.equal(field(approved, 'tokenHash'), undefined, 'administrators do not read it either')
  await assert.rejects(
    payload.update({
      collection: 'decks',
      id: aliceDeck.id,
      data: { status: 'pending' },
      user: admin,
      overrideAccess: false,
    }),
    /statut/,
  )
  const renamed = await payload.update({
    collection: 'decks',
    id: aliceDeck.id,
    data: { deckId: 'renamed' },
    user: admin,
    overrideAccess: false,
  })
  assert.equal(renamed.deckId, 'verbs', 'the deck id is not editable through the API')

  // Versions are immutable through the API.
  const edition = await payload.create({
    collection: 'editions',
    data: { deck: aliceDeck.id, code: 'fr' },
  })
  const version = await payload.create({
    collection: 'versions',
    data: {
      edition: edition.id,
      version: '2026.11.25+abc',
      receivedAt: new Date().toISOString(),
      summary: { name: 'Verbs', notes: 1 },
      files: { 'deck.json': { sha256: 'a'.repeat(64), size: 10 } },
      deckJsonSha256: 'a'.repeat(64),
    },
  })
  await assert.rejects(
    payload.create({
      collection: 'versions',
      data: {
        edition: edition.id,
        version: '2026.11.25+abc',
        receivedAt: new Date().toISOString(),
        summary: {},
        files: {},
        deckJsonSha256: 'b'.repeat(64),
      },
    }),
    'one version string per edition',
  )
  const ownVersion = await api(`/versions/${version.id}`, { cookie: alice.cookie })
  assert.equal(ownVersion.status, 200, 'the author reads their versions')
  assert.ok((await api(`/versions/${version.id}`, { cookie: bob.cookie })).status >= 400)
  for (const method of ['PATCH', 'DELETE'])
    assert.ok(
      (
        await api(`/versions/${version.id}`, {
          cookie: alice.cookie,
          method,
          body: { version: 'x' },
        })
      ).status >= 400,
      method,
    )
  assert.ok(
    (
      await api('/versions', {
        cookie: alice.cookie,
        method: 'POST',
        body: { edition: edition.id, version: 'y' },
      })
    ).status >= 400,
  )
  await assert.rejects(
    payload.update({
      collection: 'versions',
      id: version.id,
      data: { version: 'changed' },
      user: admin,
      overrideAccess: false,
    }),
  )
  await assert.rejects(
    payload.delete({ collection: 'versions', id: version.id, user: admin, overrideAccess: false }),
  )
  assert.equal(
    (await payload.findByID({ collection: 'versions', id: version.id })).version,
    '2026.11.25+abc',
  )
  console.log('Decks : pseudos et decks uniques, jetons, accès des visiteurs, versions immuables.')
} finally {
  await closeAuth()
  await payload.destroy()
}
