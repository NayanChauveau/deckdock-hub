import type { DeckId, Handle } from './handle'
import type { DeckStatus } from './status'

/** Payload document ids (Postgres serials). */
export type RecordId = number

export type Author = Readonly<{ id: RecordId; customerId: RecordId | null; handle: Handle }>

/** A deck as the module sees it. Its token is never part of it: only its hash is stored. */
export type Deck = Readonly<{
  id: RecordId
  authorId: RecordId
  deckId: DeckId
  status: DeckStatus
  approvedAt: Date | null
  hiddenReason: string | null
  tokenLastUsedAt: Date | null
}>
