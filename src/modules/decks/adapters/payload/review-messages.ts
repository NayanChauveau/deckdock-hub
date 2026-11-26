import type { DecksErrorCode } from '../../domain/errors'

/** What the administration says when a review is refused (the admin is in French only). */
export const reviewMessages = {
  transition_refused: 'Changement de statut refusé pour ce deck.',
  reason_required: 'Une raison est obligatoire pour masquer un deck.',
  account_deleted:
    'Le compte de cet auteur a été supprimé : ce deck reste masqué et ne peut plus être publié.',
  not_found: 'Deck introuvable.',
} as const satisfies Partial<Record<DecksErrorCode, string>>

export type ReviewMessageCode = keyof typeof reviewMessages

export const isReviewMessageCode = (code: string): code is ReviewMessageCode =>
  Object.hasOwn(reviewMessages, code)
