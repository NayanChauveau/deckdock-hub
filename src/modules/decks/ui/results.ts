import type { DecksErrorCode } from '../domain/errors'

/** Why an author-space action failed: a rule of the module, a lost session, or anything else. */
export type ActionError = DecksErrorCode | 'signed_out' | 'unexpected'
export interface Failed {
  ok: false
  error: ActionError
}

export type HandleResult = { ok: true } | Failed
export type CreateDeckResult = { ok: true; deckId: string; token: string } | Failed
export type TokenResult = { ok: true; token: string } | Failed
export type RevokeResult = { ok: true } | Failed
