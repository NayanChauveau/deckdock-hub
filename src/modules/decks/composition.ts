import { createHash, randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { payloadDecksStore } from './adapters/payload/store'
import type { DecksDeps } from './application/ports'

/** sha256 of a string's UTF-8 bytes, in lowercase hexadecimal (the stored token hash). */
export const sha256Hex = (text: string): string =>
  createHash('sha256').update(text, 'utf8').digest('hex')

/** The only place that ties the decks use cases to their adapters. */
export const decksDeps = (payload: Payload): DecksDeps => ({
  store: payloadDecksStore(payload),
  random: (n) => new Uint8Array(randomBytes(n)),
  hash: sha256Hex,
  clock: () => new Date(),
})
