import type { Payload } from 'payload'
import * as useCases from './application/decks'
import { decksDeps } from './composition'
import type { Author, Deck, RecordId } from './domain/model'

export { DecksError, type DecksErrorCode } from './domain/errors'
export type { Author, Deck, RecordId } from './domain/model'

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
