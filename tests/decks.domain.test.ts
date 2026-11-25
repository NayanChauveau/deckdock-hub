import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import {
  RESERVED_HANDLES,
  validateDeckId,
  validateHandle,
} from '../src/modules/decks/domain/handle'
import { canTransition, DECK_STATUSES } from '../src/modules/decks/domain/status'
import {
  hashToken,
  isPublishTokenFormat,
  newPublishToken,
  TOKEN_PREFIX,
} from '../src/modules/decks/domain/token'
import { sha256Hex } from '../src/modules/decks/domain/sha256'
import {
  chooseHandle,
  createDeck,
  deckForToken,
  regenerateToken,
  revokeToken,
  type DecksDeps,
} from '../src/modules/decks/application/decks'
import { DecksError } from '../src/modules/decks/domain/errors'
import { inMemoryDecksStore } from './support/in-memory-decks'
import { present } from './support/present'

const random = (n: number) => new Uint8Array(randomBytes(n))

void test('valid handles are accepted, normalised to lowercase', () => {
  for (const handle of ['abc', 'alice', 'a-b-c', 'deck42', 'x'.repeat(30), '0-1']) {
    const result = validateHandle(handle)
    assert.ok(result.ok, handle)
    assert.equal(result.value, handle)
  }
  const mixed = validateHandle('  Alice ')
  assert.ok(mixed.ok)
  assert.equal(mixed.value, 'alice')
})

void test('invalid handles are refused', () => {
  for (const handle of [
    '',
    'ab',
    'x'.repeat(31),
    '-abc',
    'abc-',
    'a--b',
    'a_b',
    'a.b',
    'a b',
    'é-té',
    '../x',
  ]) {
    const result = validateHandle(handle)
    assert.deepEqual(result, { ok: false, error: 'invalid' }, handle)
  }
})

void test('reserved handles are refused', () => {
  assert.deepEqual([...RESERVED_HANDLES], ['admin', 'api', 'd', 'decks', 'compte', 'fr', 'en'])
  for (const handle of ['admin', 'api', 'decks', 'compte', 'ADMIN']) {
    const result = validateHandle(handle)
    assert.deepEqual(result, { ok: false, error: 'reserved' }, handle)
  }
})

void test('deck ids follow the format slug rule', () => {
  for (const id of ['a', 'spanish-verbs', 'deck-2026']) assert.ok(validateDeckId(id).ok, id)
  for (const id of ['', 'A', 'a--b', '-a', 'a-', 'a_b', 'a/b', 'x'.repeat(101)])
    assert.deepEqual(validateDeckId(id), { ok: false, error: 'invalid' }, id)
})

void test('status transitions', () => {
  assert.deepEqual([...DECK_STATUSES], ['pending', 'approved', 'hidden'])
  assert.ok(canTransition('pending', 'approved'))
  assert.ok(canTransition('pending', 'hidden'))
  assert.ok(canTransition('approved', 'hidden'))
  assert.ok(canTransition('hidden', 'approved'))
  for (const status of DECK_STATUSES) assert.ok(!canTransition(status, status), status)
  assert.ok(!canTransition('approved', 'pending'))
  assert.ok(!canTransition('hidden', 'pending'))
})

void test('the pure sha256 matches node:crypto', () => {
  for (const input of [
    '',
    'abc',
    'ddk_x',
    'é€😀',
    'a'.repeat(55),
    'b'.repeat(64),
    'c'.repeat(1000),
  ])
    assert.equal(sha256Hex(input), createHash('sha256').update(input, 'utf8').digest('hex'), input)
})

void test('a publish token is prefixed, long, random, and only its hash is kept', () => {
  const { token, hash } = newPublishToken(random)
  assert.ok(token.startsWith(TOKEN_PREFIX))
  assert.equal(TOKEN_PREFIX, 'ddk_')
  assert.ok(token.length >= 47, String(token.length))
  assert.match(token, /^ddk_[A-Za-z0-9_-]{43}$/)
  assert.match(hash, /^[0-9a-f]{64}$/)
  assert.ok(!hash.includes(token))
  assert.ok(!hash.includes(token.slice(TOKEN_PREFIX.length)))
  assert.equal(hash, createHash('sha256').update(token).digest('hex'))
  assert.equal(hashToken(token), hash)
  assert.notEqual(newPublishToken(random).token, token)
  assert.ok(isPublishTokenFormat(token))
})

void test('the token encodes 32 random bytes in base64url without padding', () => {
  const bytes = new Uint8Array(32).map((_, index) => index * 8 + 3)
  const asked: number[] = []
  const { token } = newPublishToken((n) => {
    asked.push(n)
    return bytes
  })
  assert.deepEqual(asked, [32])
  assert.equal(token, `ddk_${Buffer.from(bytes).toString('base64url')}`)
})

void test('malformed tokens are recognised without a lookup', () => {
  for (const token of [
    '',
    'ddk_',
    'ddk_short',
    `xyz_${'a'.repeat(43)}`,
    `ddk_${'a'.repeat(42)}`,
    `ddk_${'a'.repeat(44)}`,
    `ddk_${'a'.repeat(42)}=`,
    `ddk_${'a'.repeat(42)}+`,
  ])
    assert.ok(!isPublishTokenFormat(token), token)
})

function deps(): DecksDeps & { store: ReturnType<typeof inMemoryDecksStore> } {
  let now = Date.parse('2026-11-25T10:00:00Z')
  return {
    store: inMemoryDecksStore(),
    random,
    clock: () => new Date((now += 1000)),
  }
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

void test('chooseHandle validates, reserves once, and refuses a taken handle', async () => {
  const d = deps()
  assert.equal(await code(chooseHandle(d, 1, 'ab')), 'invalid_handle')
  assert.equal(await code(chooseHandle(d, 1, 'admin')), 'reserved_handle')
  const author = await chooseHandle(d, 1, 'Alice')
  assert.equal(author.handle, 'alice')
  assert.deepEqual(await chooseHandle(d, 1, 'alice'), author, 'idempotent')
  assert.equal(await code(chooseHandle(d, 1, 'bob')), 'handle_already_chosen')
  assert.equal(await code(chooseHandle(d, 2, 'alice')), 'handle_taken')
})

void test('createDeck gives a token whose hash only is stored, and deckForToken finds it', async () => {
  const d = deps()
  assert.equal(await code(createDeck(d, 1, 'verbs')), 'no_handle')
  await chooseHandle(d, 1, 'alice')
  assert.equal(await code(createDeck(d, 1, 'Bad Id')), 'invalid_deck_id')
  const { deck, token } = await createDeck(d, 1, 'verbs')
  assert.equal(deck.status, 'pending')
  assert.equal(deck.deckId, 'verbs')
  assert.equal(deck.tokenLastUsedAt, null)
  assert.ok(!JSON.stringify(d.store.dump()).includes(token))
  assert.equal(await code(createDeck(d, 1, 'verbs')), 'deck_exists')
  const found = present(await deckForToken(d, token))
  assert.equal(found.id, deck.id)
  assert.ok(found.tokenLastUsedAt instanceof Date)
  assert.equal(
    (await d.store.deckOf(deck.authorId, deck.deckId))?.tokenLastUsedAt?.getTime(),
    found.tokenLastUsedAt.getTime(),
  )
})

void test('regenerate invalidates the old token; revoke leaves none; malformed is null', async () => {
  const d = deps()
  await chooseHandle(d, 1, 'alice')
  const { token } = await createDeck(d, 1, 'verbs')
  const next = await regenerateToken(d, 1, 'verbs')
  assert.notEqual(next, token)
  assert.equal(await deckForToken(d, token), null)
  assert.ok(await deckForToken(d, next))
  await revokeToken(d, 1, 'verbs')
  assert.equal(await deckForToken(d, next), null)
  assert.equal(await code(regenerateToken(d, 2, 'verbs')), 'not_found')
  assert.equal(await code(revokeToken(d, 1, 'other')), 'not_found')
  let lookups = 0
  const counting = {
    ...d,
    store: {
      ...d.store,
      deckByTokenHash: async (hash: string) => (lookups++, d.store.deckByTokenHash(hash)),
    },
  }
  assert.equal(await deckForToken(counting, 'not-a-token'), null)
  assert.equal(lookups, 0)
})
