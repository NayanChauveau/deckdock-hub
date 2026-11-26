import { fail, ok, type Result } from './result'
import { canTransition, type DeckStatus } from './status'

/**
 * The reason stored on the decks of a deleted account. It is for people reading the admin; the
 * rule itself rests on the author's detached account (`accountDeleted`), which nothing can undo.
 */
export const ACCOUNT_DELETED_REASON = 'Compte supprimé'

export type ReviewRefusal = 'transition_refused' | 'reason_required' | 'account_deleted'

/**
 * An administrator's review of a deck: approve it (`approved`) or hide it (`hidden`, with a
 * reason). A deck whose author deleted their account is never approved again; approving clears
 * the reason of an earlier hiding.
 */
export function reviewDeck(
  current: { status: DeckStatus; accountDeleted: boolean },
  to: DeckStatus,
  reason: string | null,
): Result<{ status: DeckStatus; hiddenReason: string | null }, ReviewRefusal> {
  if (to === 'approved' && current.accountDeleted) return fail('account_deleted')
  if (!canTransition(current.status, to)) return fail('transition_refused')
  if (to !== 'hidden') return ok({ status: to, hiddenReason: null })
  const trimmed = reason?.trim() ?? ''
  return trimmed ? ok({ status: to, hiddenReason: trimmed }) : fail('reason_required')
}
