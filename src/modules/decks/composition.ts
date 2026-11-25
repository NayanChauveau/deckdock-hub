import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { payloadDecksStore } from './adapters/payload/store'
import type { DecksDeps } from './application/ports'

/** The only place that ties the decks use cases to their adapters. */
export const decksDeps = (payload: Payload): DecksDeps => ({
  store: payloadDecksStore(payload),
  random: (n) => new Uint8Array(randomBytes(n)),
  clock: () => new Date(),
})
