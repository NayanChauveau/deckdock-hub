/** `pending` until an administrator approves it; `hidden` is never served. */
export const DECK_STATUSES = Object.freeze(['pending', 'approved', 'hidden'] as const)
export type DeckStatus = (typeof DECK_STATUSES)[number]

const transitions: Readonly<Record<DeckStatus, readonly DeckStatus[]>> = {
  pending: ['approved', 'hidden'],
  approved: ['hidden'],
  // An administrator may restore a deck hidden by mistake; it never goes back to review.
  hidden: ['approved'],
}

export const isDeckStatus = (value: unknown): value is DeckStatus =>
  typeof value === 'string' && (DECK_STATUSES as readonly string[]).includes(value)

export const canTransition = (from: DeckStatus, to: DeckStatus): boolean =>
  transitions[from].includes(to)
