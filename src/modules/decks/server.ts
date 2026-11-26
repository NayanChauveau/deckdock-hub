import type { Payload } from 'payload'
import type { Upload } from './adapters/files/workspace'
import * as authorSpaceUseCases from './application/author-space'
import * as useCases from './application/decks'
import * as reviewUseCases from './application/review'
import * as publishUseCase from './application/publish'
import type { PublishResult } from './application/publish'
import * as serveUseCase from './application/serve'
import type { ServeRequest, ServeResult } from './application/serve'
import { decksDeps, publishDeps, serveDeps } from './composition'
import type { Author, Deck, EditionHistory, PendingDeck, RecordId } from './domain/model'

export { DecksError, type DecksErrorCode } from './domain/errors'
export type {
  Author,
  Deck,
  EditionHistory,
  PendingDeck,
  ReceivedVersion,
  RecordId,
} from './domain/model'
export type { DeckStatus } from './domain/status'
export { ACCOUNT_DELETED_REASON } from './domain/review'
export type { PublishBody, PublishResult } from './application/publish'
export type { ServeRequest, ServeResult } from './application/serve'
export { editionAddress, servePath } from './domain/serving'

/** The decks use cases bound to the site's adapters, for routes, pages and hooks. */
export const chooseHandle = (
  payload: Payload,
  customerId: RecordId,
  handle: string,
): Promise<Author> => useCases.chooseHandle(decksDeps(payload), customerId, handle)
export const createDeck = (
  payload: Payload,
  customerId: RecordId,
  deckId: string,
): Promise<{ deck: Deck; token: string }> =>
  useCases.createDeck(decksDeps(payload), customerId, deckId)
export const regenerateToken = (
  payload: Payload,
  customerId: RecordId,
  deckId: string,
): Promise<string> => useCases.regenerateToken(decksDeps(payload), customerId, deckId)
export const revokeToken = (
  payload: Payload,
  customerId: RecordId,
  deckId: string,
): Promise<void> => useCases.revokeToken(decksDeps(payload), customerId, deckId)
export const deckForToken = (payload: Payload, token: string): Promise<Deck | null> =>
  useCases.deckForToken(decksDeps(payload), token)

/** The customer's author space: their handle, if chosen, and their decks. */
export const authorSpace = (
  payload: Payload,
  customerId: RecordId,
): Promise<{ author: Author | null; decks: Deck[] }> =>
  authorSpaceUseCases.authorSpace(decksDeps(payload), customerId)
/** One of the customer's decks with its editions and received versions (`not_found` otherwise). */
export const authorDeck = (
  payload: Payload,
  customerId: RecordId,
  deckId: string,
): Promise<{ author: Author; deck: Deck; editions: EditionHistory[] }> =>
  authorSpaceUseCases.authorDeck(decksDeps(payload), customerId, deckId)

/** The admin review (the admin endpoints run them in their request's transaction). */
export const approveDeck = (payload: Payload, id: RecordId): Promise<Deck> =>
  reviewUseCases.approveDeck(decksDeps(payload), id)
export const hideDeck = (payload: Payload, id: RecordId, reason: string): Promise<Deck> =>
  reviewUseCases.hideDeck(decksDeps(payload), id, reason)
export const pendingDecks = (payload: Payload): Promise<PendingDeck[]> =>
  reviewUseCases.pendingDecks(decksDeps(payload))

/** Publishes one compiled edition sent by a deck's CI (`POST /api/publish/<edition>`). */
export const publishEdition = (
  payload: Payload,
  input: { token: string; edition: string; archive: Upload },
): Promise<PublishResult> => publishUseCase.publishEdition(publishDeps(payload), input)

/** Resolves a public `/d/<handle>/<deck-id>/<path>` request (index.json, deck.json, media). */
export const serveDeckFile = (payload: Payload, request: ServeRequest): Promise<ServeResult> =>
  serveUseCase.serveDeckFile(serveDeps(payload), request)
