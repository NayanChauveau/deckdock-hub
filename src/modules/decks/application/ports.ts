import type { DeckId, Handle } from '../domain/handle'
import type { Author, Deck, EditionHistory, PendingDeck, RecordId } from '../domain/model'
import type { DeckStatus } from '../domain/status'
import type { TokenHasher } from '../domain/token'

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
  authorById(id: RecordId): Promise<Author | null>
  deckById(id: RecordId): Promise<Deck | null>
  /** The author's decks, by `deckId`. */
  decksOfAuthor(authorId: RecordId): Promise<Deck[]>
  /** Writes an administrator's review (status and reason). */
  setReview(
    deck: RecordId,
    review: { status: DeckStatus; hiddenReason: string | null },
  ): Promise<Deck>
  /**
   * Hides every deck of the author with this reason and revokes their tokens, in one statement:
   * all or nothing, whatever the caller's transaction does with other documents. Returns how many.
   */
  retireDecksOfAuthor(authorId: RecordId, reason: string): Promise<number>
  /** The `pending` decks, oldest first. */
  pendingDecks(): Promise<PendingDeck[]>
  /** The deck's editions by code, each with its received versions, newest first. */
  editionsOf(deck: RecordId): Promise<EditionHistory[]>
}

export interface DecksDeps {
  store: DecksStore
  /** Secure random bytes. */
  random: (n: number) => Uint8Array
  /** sha256 hex of a token string. */
  hash: TokenHasher
  clock: () => Date
}
