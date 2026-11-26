import type { DecksErrorCode } from '../domain/errors'

/**
 * Why an author-space action failed: a rule of the module, a lost session, the site's maintenance
 * (visitors are kept out), or anything else.
 */
export type ActionError = DecksErrorCode | 'signed_out' | 'maintenance' | 'unexpected'

/** A failure the forms show as a whole (not under a field). */
export type Failure = 'signed_out' | 'maintenance' | 'error'
export const failureOf = (error: ActionError): Failure =>
  error === 'signed_out' || error === 'maintenance' ? error : 'error'
export interface Failed {
  ok: false
  error: ActionError
}

export type HandleResult = { ok: true } | Failed
export type CreateDeckResult = { ok: true; deckId: string; token: string } | Failed
export type TokenResult = { ok: true; token: string } | Failed
export type RevokeResult = { ok: true } | Failed
