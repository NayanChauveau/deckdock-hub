import { DecksError } from '../domain/errors'
import type { Deck, PendingDeck, RecordId } from '../domain/model'
import { ACCOUNT_DELETED_REASON, reviewDeck } from '../domain/review'
import type { DeckStatus } from '../domain/status'
import type { DecksDeps } from './ports'

async function review(
  deps: DecksDeps,
  id: RecordId,
  to: DeckStatus,
  reason: string | null,
): Promise<Deck> {
  const deck = await deps.store.deckById(id)
  if (!deck) throw new DecksError('not_found')
  const author = await deps.store.authorById(deck.authorId)
  // An author without an account is a deleted account: its handle stays, its decks stay hidden.
  const accountDeleted = (author?.customerId ?? null) === null
  const decision = reviewDeck({ status: deck.status, accountDeleted }, to, reason)
  if (!decision.ok) throw new DecksError(decision.error)
  return deps.store.setReview(deck.id, decision.value)
}

/** An administrator publishes a deck: it enters the catalogue. */
export const approveDeck = (deps: DecksDeps, id: RecordId): Promise<Deck> =>
  review(deps, id, 'approved', null)

/** An administrator hides a deck, with a reason: it leaves the catalogue and is no longer served. */
export const hideDeck = (deps: DecksDeps, id: RecordId, reason: string): Promise<Deck> =>
  review(deps, id, 'hidden', reason)

/** The decks awaiting review, oldest first. */
export const pendingDecks = (deps: DecksDeps): Promise<PendingDeck[]> => deps.store.pendingDecks()

/**
 * When a customer deletes their account: every deck of theirs is hidden ("account deleted") and its
 * token revoked. The author entry stays, so that nobody else takes the handle. Returns how many
 * decks were retired; an account that never chose a handle has none.
 */
export async function retireAccountDecks(deps: DecksDeps, customerId: RecordId): Promise<number> {
  const author = await deps.store.authorOfCustomer(customerId)
  if (!author) return 0
  const decks = await deps.store.decksOfAuthor(author.id)
  for (const deck of decks) await deps.store.retire(deck.id, ACCOUNT_DELETED_REASON)
  return decks.length
}
