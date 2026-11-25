import type { DeckId, Handle } from '../domain/handle'
import type { Author, Deck, RecordId } from '../domain/model'

/**
 * Where authors and decks live. Uniqueness (one author per customer, one handle, one `deckId` per
 * author) is the store's job, since only the database can enforce it under concurrency: a
 * conflicting write throws `DecksError` (`handle_taken`, `handle_already_chosen`, `deck_exists`).
 */
export interface DecksStore {
  authorOfCustomer(customerId: RecordId): Promise<Author | null>
  createAuthor(customerId: RecordId, handle: Handle): Promise<Author>
  deckOf(authorId: RecordId, deckId: DeckId): Promise<Deck | null>
  /** A new `pending` deck holding the hash of its first token. */
  createDeck(authorId: RecordId, deckId: DeckId, tokenHash: string): Promise<Deck>
  /** Replaces the token hash; `null` revokes the token. */
  setTokenHash(deck: RecordId, tokenHash: string | null): Promise<void>
  /** Looked up by the hash (an indexed equality), never by comparing tokens. */
  deckByTokenHash(tokenHash: string): Promise<Deck | null>
  touchToken(deck: RecordId, at: Date): Promise<void>
}

export interface DecksDeps {
  store: DecksStore
  /** Secure random bytes. */
  random: (n: number) => Uint8Array
  clock: () => Date
}
