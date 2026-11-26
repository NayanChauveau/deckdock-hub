import { isEditionCode } from './edition'

/** `index.json`'s format, in the format's "Publishing layout". */
export const INDEX_FORMAT = 'deckdock-index/1'

/** One line of `index.json`, copied from the `deck` object of the edition's latest deck.json. */
export interface IndexEntry {
  edition: string
  name: string
  language: string[]
  version: string
}

/** Compares strings by Unicode code point, as Python's `sorted` does (not by UTF-16 unit). */
function byCodePoint(a: string, b: string): number {
  const left = Array.from(a)
  const right = Array.from(b)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const diff = (left[i]?.codePointAt(0) ?? 0) - (right[i]?.codePointAt(0) ?? 0)
    if (diff !== 0) return diff
  }
  return left.length - right.length
}

/**
 * The exact text of `<base>/index.json`: the editions sorted by code, written as the template's
 * `make_index.py` writes it (`json.dumps(…, ensure_ascii=False, indent=2) + "\n"`). The same
 * editions always give the same bytes, so their hash is a stable ETag.
 */
export function indexText(entries: readonly IndexEntry[]): string {
  const editions = [...entries]
    .sort((a, b) => byCodePoint(a.edition, b.edition))
    .map(({ edition, name, language, version }) => ({
      edition,
      name,
      language: [...language],
      version,
    }))
  return `${JSON.stringify({ format: INDEX_FORMAT, editions }, null, 2)}\n`
}

/** What a path below `/d/<handle>/<deck-id>/` names; its segments are already percent-decoded. */
export type ServeTarget =
  | { kind: 'index' }
  | { kind: 'deck'; edition: string }
  | { kind: 'media'; edition: string; filename: string }

/** A media file name as the format allows it: non-empty, not `.` or `..`, no `/` or `\`. */
const isMediaName = (name: string): boolean =>
  name.length > 0 && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')

/** `index.json`, `<edition>/deck.json` or `<edition>/media/<file>`; anything else is `null`. */
export function parseServePath(segments: readonly string[]): ServeTarget | null {
  const [first, second, third, ...rest] = segments
  if (first === undefined || rest.length > 0) return null
  if (second === undefined) return first === 'index.json' ? { kind: 'index' } : null
  if (!isEditionCode(first)) return null
  if (third === undefined) return second === 'deck.json' ? { kind: 'deck', edition: first } : null
  return second === 'media' && isMediaName(third)
    ? { kind: 'media', edition: first, filename: third }
    : null
}

/** RFC 3986 percent-encoding of one path segment (also `!'()*`, as Python's `quote(…, safe='')`). */
export const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/** The path of a served file: `servePath(handle, deckId, 'en', 'media', 'a b.png')`. */
export const servePath = (handle: string, deckId: string, ...rest: string[]): string =>
  ['', 'd', handle, deckId, ...rest].map(encodeSegment).join('/')

/** The address a learner pastes into the add-on for one edition: `<base>/<edition>/`. */
export const editionAddress = (
  origin: string,
  handle: string,
  deckId: string,
  edition: string,
): string => `${origin.replace(/\/+$/, '')}${servePath(handle, deckId, edition)}/`

/** The public page of a deck: `/{locale}/d/<handle>/<deck-id>`. */
export const deckPagePath = (locale: string, handle: string, deckId: string): string =>
  `/${encodeSegment(locale)}${servePath(handle, deckId)}`

/** The preview document of one side of a preview note: `/preview/<handle>/<deck-id>/<edition>/<n>/<side>`. */
export const previewPath = (
  handle: string,
  deckId: string,
  edition: string,
  index: number,
  side: 'front' | 'back',
): string =>
  ['', 'preview', handle, deckId, edition, String(index), side].map(encodeSegment).join('/')
