import { DecksError } from '../domain/errors'
import { validateDeckId } from '../domain/handle'
import type { Author, Deck, EditionHistory, RecordId } from '../domain/model'
import type { DecksDeps } from './ports'

/** The author space of a customer: their handle (if chosen) and their decks. */
export async function authorSpace(
  deps: DecksDeps,
  customerId: RecordId,
): Promise<{ author: Author | null; decks: Deck[] }> {
  const author = await deps.store.authorOfCustomer(customerId)
  return { author, decks: author ? await deps.store.decksOfAuthor(author.id) : [] }
}

/** One deck of the customer, with its editions and received versions; `not_found` otherwise. */
export async function authorDeck(
  deps: DecksDeps,
  customerId: RecordId,
  deckId: string,
): Promise<{ author: Author; deck: Deck; editions: EditionHistory[] }> {
  const author = await deps.store.authorOfCustomer(customerId)
  const valid = validateDeckId(deckId)
  const deck = author && valid.ok ? await deps.store.deckOf(author.id, valid.value) : null
  if (!author || !deck) throw new DecksError('not_found')
  return { author, deck, editions: await deps.store.editionsOf(deck.id) }
}
