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

/** A deck awaiting an administrator's review, as the admin lists it. */
export type PendingDeck = Readonly<{
  id: RecordId
  deckId: DeckId
  handle: Handle
  createdAt: Date
}>

/** One version received for an edition, as its author sees it. */
export type ReceivedVersion = Readonly<{ version: string; receivedAt: Date; notes: number }>

/** An edition of a deck and the versions received for it, newest first. */
export type EditionHistory = Readonly<{ code: string; versions: readonly ReceivedVersion[] }>
