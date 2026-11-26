/** Longest edition code accepted: it is a path segment of every address of the edition. */
export const MAX_EDITION_LENGTH = 100

// Control characters (C0, DEL, C1): never part of a path segment the hub writes or serves.
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/**
 * An edition code as the format defines it (non-empty, not `.` or `..`, no `/` or `\`), bounded in
 * length and without control characters, since it names a directory and a URL segment.
 */
export function isEditionCode(code: string): boolean {
  return (
    code.length > 0 &&
    code.length <= MAX_EDITION_LENGTH &&
    code !== '.' &&
    code !== '..' &&
    !code.includes('/') &&
    !code.includes('\\') &&
    !CONTROL.test(code)
  )
}

/** What the hub keeps of a checked `deck.json`. */
export interface DeckFacts {
  id: string
  edition: string
  version: string
  name: string
  description: string | null
  languages: string[]
  license: string | null
  homepage: string | null
  icon: string | null
  notes: number
}

const get = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/**
 * The facts of a `deck.json` that `deckdock check` accepted. Read defensively all the same: a
 * value of the wrong type becomes empty rather than trusted.
 */
export function deckFacts(json: unknown): DeckFacts {
  const deck = get(json, 'deck')
  const languages = get(deck, 'language')
  const notes = get(json, 'notes')
  return {
    id: text(get(deck, 'id')) ?? '',
    edition: text(get(deck, 'edition')) ?? '',
    version: text(get(deck, 'version')) ?? '',
    name: text(get(deck, 'name')) ?? '',
    description: text(get(deck, 'description')),
    languages: Array.isArray(languages)
      ? languages.filter((code): code is string => typeof code === 'string')
      : [],
    license: text(get(deck, 'license')),
    homepage: text(get(deck, 'homepage')),
    icon: text(get(deck, 'icon')) || null,
    notes: Array.isArray(notes) ? notes.length : 0,
  }
}
