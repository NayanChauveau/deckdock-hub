export type DecksErrorCode =
  | 'invalid_handle'
  | 'reserved_handle'
  | 'handle_taken'
  | 'handle_already_chosen'
  | 'no_handle'
  | 'invalid_deck_id'
  | 'deck_exists'
  | 'not_found'
  | 'transition_refused'
  | 'reason_required'
  | 'account_deleted'

/** Business failures of the decks module carry a semantic code, never a transport status. */
export class DecksError extends Error {
  constructor(
    public readonly code: DecksErrorCode,
    message: string = code,
  ) {
    super(message)
    this.name = 'DecksError'
  }
}
