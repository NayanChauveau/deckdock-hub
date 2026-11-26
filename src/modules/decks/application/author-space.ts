import { DecksError } from '../domain/errors'
import { validateDeckId } from '../domain/handle'
import type { Author, Deck, EditionHistory, RecordId } from '../domain/model'
import { defaultEdition, type EditionCard } from './catalogue'
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

/** What the author space's list shows of one deck. */
export interface AuthorDeckSummary {
  deck: Deck
  /** The name of the edition in the reader's language (else the first), or the deck's id. */
  name: string
  icon: string | null
  /** Its editions' codes, sorted. */
  editions: string[]
  /** The latest version received among its editions, or null before the first one. */
  version: string | null
}

/**
 * A deck of the author space from its editions' latest versions (the catalogue's view of them):
 * named and drawn like its catalogue card, with the most recent version received.
 */
export function summarizeDeck(
  deck: Deck,
  editions: readonly (EditionCard & { version: string; receivedAt: Date })[],
  locale: string,
): AuthorDeckSummary {
  const shown = defaultEdition(editions, locale)
  const latest = editions.reduce<(typeof editions)[number] | null>(
    (best, edition) =>
      !best || edition.receivedAt.getTime() > best.receivedAt.getTime() ? edition : best,
    null,
  )
  return {
    deck,
    name: shown?.name.trim() || deck.deckId,
    icon: shown?.icon ?? null,
    editions: editions.map((edition) => edition.code).sort(),
    version: latest?.version ?? null,
  }
}
