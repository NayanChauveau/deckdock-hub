import { fail, ok, type Result } from './result'

/** A public author name, as it appears in addresses: `/d/<handle>/<deck-id>`. */
export type Handle = string & { readonly __brand: 'Handle' }
/** The `deck.id` of the format, unique per author. */
export type DeckId = string & { readonly __brand: 'DeckId' }

/** Path segments of the site that a handle must never shadow. */
export const RESERVED_HANDLES: readonly string[] = Object.freeze([
  'admin',
  'api',
  'd',
  'decks',
  'compte',
  'fr',
  'en',
])

// The format's slug rule (deckdock `SLUG_RE`): lowercase letters, digits and single dashes.
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A handle of 3 to 30 characters following the slug rule, compared in lowercase (surrounding
 * spaces and capitals typed by the author are forgiven, the stored value is the normalised one).
 */
export function validateHandle(handle: string): Result<Handle, 'invalid' | 'reserved'> {
  const value = handle.trim().toLowerCase()
  if (value.length < 3 || value.length > 30 || !SLUG.test(value)) return fail('invalid')
  if (RESERVED_HANDLES.includes(value)) return fail('reserved')
  return ok(value as Handle)
}

/** Exactly the format's rule (no normalisation: it must equal the `deck.id` of the CI's file). */
export function validateDeckId(deckId: string): Result<DeckId, 'invalid'> {
  if (deckId.length > 100 || !SLUG.test(deckId)) return fail('invalid')
  return ok(deckId as DeckId)
}
