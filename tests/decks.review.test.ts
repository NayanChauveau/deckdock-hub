import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { ACCOUNT_DELETED_REASON, reviewDeck } from '../src/modules/decks/domain/review'
import { chooseHandle, createDeck, type DecksDeps } from '../src/modules/decks/application/decks'
import {
  approveDeck,
  hideDeck,
  pendingDecks,
  retireAccountDecks,
} from '../src/modules/decks/application/review'
import { authorDeck, authorSpace } from '../src/modules/decks/application/author-space'
import { DecksError } from '../src/modules/decks/domain/errors'
import { inMemoryDecksStore } from './support/in-memory-decks'
import { present } from './support/present'

const random = (n: number) => new Uint8Array(randomBytes(n))
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

function deps(): DecksDeps & { store: ReturnType<typeof inMemoryDecksStore> } {
  let now = Date.parse('2026-11-26T10:00:00Z')
  return { store: inMemoryDecksStore(), random, hash, clock: () => new Date((now += 1000)) }
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

void test('reviewDeck: approval, hiding with a reason, refused transitions', () => {
  const live = { accountDeleted: false }
  assert.deepEqual(reviewDeck({ status: 'pending', ...live }, 'approved', null), {
    ok: true,
    value: { status: 'approved', hiddenReason: null },
  })
  assert.deepEqual(reviewDeck({ status: 'approved', ...live }, 'hidden', '  Spam  '), {
    ok: true,
    value: { status: 'hidden', hiddenReason: 'Spam' },
  })
  for (const reason of [null, '', '   \n'])
    assert.deepEqual(reviewDeck({ status: 'pending', ...live }, 'hidden', reason), {
      ok: false,
      error: 'reason_required',
    })
  assert.deepEqual(reviewDeck({ status: 'approved', ...live }, 'pending', null), {
    ok: false,
    error: 'transition_refused',
  })
  assert.deepEqual(reviewDeck({ status: 'approved', ...live }, 'approved', null), {
    ok: false,
    error: 'transition_refused',
  })
  // Restoring a deck hidden by mistake clears its reason.
  assert.deepEqual(reviewDeck({ status: 'hidden', ...live }, 'approved', 'old reason'), {
    ok: true,
    value: { status: 'approved', hiddenReason: null },
  })
})

void test('reviewDeck: a deck whose account was deleted is never approved again', () => {
  for (const status of ['pending', 'hidden'] as const)
    assert.deepEqual(reviewDeck({ status, accountDeleted: true }, 'approved', null), {
      ok: false,
      error: 'account_deleted',
    })
  assert.ok(reviewDeck({ status: 'approved', accountDeleted: true }, 'hidden', 'x').ok)
  assert.ok(ACCOUNT_DELETED_REASON.trim().length > 0)
})

void test('approveDeck and hideDeck follow the review rules', async () => {
  const d = deps()
  await chooseHandle(d, 1, 'alice')
  const { deck } = await createDeck(d, 1, 'verbs')
  assert.equal(await code(hideDeck(d, deck.id, ' ')), 'reason_required')
  assert.equal(present(await d.store.deckById(deck.id)).status, 'pending', 'nothing written')
  const approved = await approveDeck(d, deck.id)
  assert.equal(approved.status, 'approved')
  assert.equal(await code(approveDeck(d, deck.id)), 'transition_refused')
  const hidden = await hideDeck(d, deck.id, 'Contenu sans licence')
  assert.equal(hidden.status, 'hidden')
  assert.equal(hidden.hiddenReason, 'Contenu sans licence')
  assert.equal(await code(approveDeck(d, 999)), 'not_found')
  assert.equal(await code(hideDeck(d, 999, 'x')), 'not_found')
})

void test('pendingDecks lists the decks awaiting review with their handle', async () => {
  const d = deps()
  await chooseHandle(d, 1, 'alice')
  await chooseHandle(d, 2, 'bob')
  const { deck: verbs } = await createDeck(d, 1, 'verbs')
  await createDeck(d, 2, 'kanji')
  await approveDeck(d, verbs.id)
  assert.deepEqual(
    (await pendingDecks(d)).map(({ handle, deckId }) => `${handle}/${deckId}`),
    ['bob/kanji'],
  )
})

void test('retireAccountDecks hides every deck of the account and revokes their tokens', async () => {
  const d = deps()
  await chooseHandle(d, 1, 'alice')
  await chooseHandle(d, 2, 'bob')
  const { deck: a } = await createDeck(d, 1, 'a')
  const { deck: b } = await createDeck(d, 1, 'b')
  const { deck: c, token: bobToken } = await createDeck(d, 1, 'c')
  const { deck: bobs } = await createDeck(d, 2, 'kanji')
  await approveDeck(d, a.id)
  await hideDeck(d, c.id, 'Doublon')
  assert.equal(await retireAccountDecks(d, 1), 3)
  for (const id of [a.id, b.id, c.id]) {
    const deck = present(await d.store.deckById(id))
    assert.equal(deck.status, 'hidden')
    assert.equal(deck.hiddenReason, ACCOUNT_DELETED_REASON)
    assert.equal(d.store.tokenHashOf(id), null, 'token revoked')
  }
  assert.equal(await d.store.deckByTokenHash(hash(bobToken)), null)
  assert.equal(present(await d.store.deckById(bobs.id)).status, 'pending', 'other authors kept')
  assert.notEqual(d.store.tokenHashOf(bobs.id), null)
  assert.equal(await retireAccountDecks(d, 3), 0, 'an account without a handle: nothing to do')
  // The handle stays: once the account is detached, its decks can't be approved again.
  d.store.detachCustomer(1)
  assert.equal(await code(approveDeck(d, a.id)), 'account_deleted')
  assert.equal(await code(chooseHandle(d, 4, 'alice')), 'handle_taken')
})

void test('authorSpace and authorDeck show only the customer’s own decks', async () => {
  const d = deps()
  assert.deepEqual(await authorSpace(d, 1), { author: null, decks: [] })
  await chooseHandle(d, 1, 'alice')
  await chooseHandle(d, 2, 'bob')
  await createDeck(d, 1, 'verbs')
  const { deck: kanji } = await createDeck(d, 1, 'kanji')
  await createDeck(d, 2, 'other')
  const space = await authorSpace(d, 1)
  assert.equal(space.author?.handle, 'alice')
  assert.deepEqual(
    space.decks.map((deck) => deck.deckId),
    ['kanji', 'verbs'],
  )
  d.store.addVersion(kanji.id, 'en', { version: 'v1', receivedAt: new Date(1000), notes: 3 })
  d.store.addVersion(kanji.id, 'en', { version: 'v2', receivedAt: new Date(2000), notes: 4 })
  d.store.addVersion(kanji.id, 'fr', { version: 'v1', receivedAt: new Date(1500), notes: 3 })
  const view = await authorDeck(d, 1, 'kanji')
  assert.equal(view.author.handle, 'alice')
  assert.equal(view.deck.id, kanji.id)
  assert.deepEqual(
    view.editions.map((edition) => [edition.code, edition.versions.map((v) => v.version)]),
    [
      ['en', ['v2', 'v1']],
      ['fr', ['v1']],
    ],
  )
  assert.equal(await code(authorDeck(d, 1, 'other')), 'not_found')
  assert.equal(await code(authorDeck(d, 2, 'kanji')), 'not_found')
  assert.equal(await code(authorDeck(d, 3, 'kanji')), 'not_found')
})
