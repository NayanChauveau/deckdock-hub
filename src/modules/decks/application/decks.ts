import { DecksError } from '../domain/errors'
import { validateDeckId, validateHandle } from '../domain/handle'
import type { Author, Deck, RecordId } from '../domain/model'
import { isPublishTokenFormat, newPublishToken } from '../domain/token'
import type { DecksDeps } from './ports'

export type { DecksDeps, DecksStore } from './ports'

/**
 * The customer's public handle, chosen once: it is part of every address of their decks. Choosing
 * the same handle again is a no-op; another one is refused.
 */
export async function chooseHandle(
  deps: DecksDeps,
  customerId: RecordId,
  handle: string,
): Promise<Author> {
  const valid = validateHandle(handle)
  if (!valid.ok)
    throw new DecksError(valid.error === 'reserved' ? 'reserved_handle' : 'invalid_handle')
  const existing = await deps.store.authorOfCustomer(customerId)
  if (existing) {
    if (existing.handle === valid.value) return existing
    throw new DecksError('handle_already_chosen')
  }
  return deps.store.createAuthor(customerId, valid.value)
}

async function ownDeck(deps: DecksDeps, customerId: RecordId, deckId: string): Promise<Deck> {
  const author = await deps.store.authorOfCustomer(customerId)
  const valid = validateDeckId(deckId)
  const deck = author && valid.ok ? await deps.store.deckOf(author.id, valid.value) : null
  if (!deck) throw new DecksError('not_found')
  return deck
}

/** A new `pending` deck and its first publish token, shown once (only its hash is stored). */
export async function createDeck(
  deps: DecksDeps,
  customerId: RecordId,
  deckId: string,
): Promise<{ deck: Deck; token: string }> {
  const author = await deps.store.authorOfCustomer(customerId)
  if (!author) throw new DecksError('no_handle')
  const valid = validateDeckId(deckId)
  if (!valid.ok) throw new DecksError('invalid_deck_id')
  if (await deps.store.deckOf(author.id, valid.value)) throw new DecksError('deck_exists')
  const { token, hash } = newPublishToken(deps.random, deps.hash)
  const deck = await deps.store.createDeck(author.id, valid.value, hash)
  return { deck, token }
}

/** A new token for one of the customer's decks; the previous one stops working at once. */
export async function regenerateToken(
  deps: DecksDeps,
  customerId: RecordId,
  deckId: string,
): Promise<string> {
  const deck = await ownDeck(deps, customerId, deckId)
  const { token, hash } = newPublishToken(deps.random, deps.hash)
  await deps.store.setTokenHash(deck.id, hash)
  return token
}

/** The deck keeps no valid token until the author regenerates one. */
export async function revokeToken(
  deps: DecksDeps,
  customerId: RecordId,
  deckId: string,
): Promise<void> {
  const deck = await ownDeck(deps, customerId, deckId)
  await deps.store.setTokenHash(deck.id, null)
}

/**
 * The deck a publish token belongs to, whatever its status (the caller refuses a hidden deck), and
 * records the use. A malformed token is refused without touching the store; a revoked one has no
 * hash to match. The lookup is an equality on the hash, so no token is ever compared byte by byte.
 */
export async function deckForToken(deps: DecksDeps, token: string): Promise<Deck | null> {
  if (!isPublishTokenFormat(token)) return null
  const deck = await deps.store.deckByTokenHash(deps.hash(token))
  if (!deck) return null
  const at = deps.clock()
  await deps.store.touchToken(deck.id, at)
  return { ...deck, tokenLastUsedAt: at }
}
