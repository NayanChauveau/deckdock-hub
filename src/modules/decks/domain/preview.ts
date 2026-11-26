/** A card template of a notetype, in Anki's syntax (`{{Field}}`, `{{cloze:Text}}`…). */
export interface CardTemplate {
  name: string
  front: string
  back: string
}

/** A notetype of a `deckdock/1` file, as the preview needs it. */
export interface Notetype {
  id: string
  name: string
  kind: 'standard' | 'cloze'
  fields: string[]
  templates: CardTemplate[]
  css: string
}

/** A note: its notetype's `id`, its field values (HTML) and its tags. */
export interface Note {
  notetype: string
  fields: Record<string, string>
  tags: string[]
}

/**
 * What the deck page previews of one version, kept at publish time so that a page view never
 * reads a whole deck.json: a few notes, their notetypes, and the listed media files they refer to.
 */
export interface DeckPreview {
  notetypes: Notetype[]
  notes: Note[]
  /** File names of the edition's `media` that the notes, templates and CSS above refer to. */
  media: string[]
  /** The edition's first language (`deck.language[0]`), for the preview document's `lang`. */
  language?: string
}

/** Notes shown on a deck page. */
export const PREVIEW_NOTES = 5
/**
 * A note heavier than this (its fields, serialised) is left out of the preview, and so is a
 * notetype whose CSS or one of whose templates is longer (with its notes): never truncated, since
 * a cut template or stylesheet would render wrongly.
 */
export const MAX_PREVIEW_TEXT_CHARS = 20_000

const get = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
const isString = (value: unknown): value is string => typeof value === 'string'
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const strings = (value: unknown): string[] => list(value).filter(isString)

function toTemplate(value: unknown): CardTemplate | null {
  const name = get(value, 'name')
  const front = get(value, 'front')
  const back = get(value, 'back')
  return isString(name) && isString(front) && isString(back) ? { name, front, back } : null
}

function toNotetype(value: unknown): Notetype | null {
  const id = get(value, 'id')
  const name = get(value, 'name')
  const kind = get(value, 'kind')
  const css = get(value, 'css')
  const templates = list(get(value, 'templates')).map(toTemplate)
  if (!isString(id) || !isString(name) || !isString(css)) return null
  if (kind !== 'standard' && kind !== 'cloze') return null
  if (templates.some((template) => template === null)) return null
  return {
    id,
    name,
    kind,
    fields: strings(get(value, 'fields')),
    templates: templates.filter((template): template is CardTemplate => template !== null),
    css,
  }
}

function toNote(value: unknown): Note | null {
  const notetype = get(value, 'notetype')
  const raw = get(value, 'fields')
  if (!isString(notetype) || typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return null
  const fields: Record<string, string> = {}
  for (const [key, field] of Object.entries(raw)) if (isString(field)) fields[key] = field
  return { notetype, fields, tags: strings(get(value, 'tags')) }
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** `&amp;`, `&#39;`, `&#x27;`… replaced by their characters; unknown entities are kept. */
export function unescapeHtml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (entity, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : Number(body.slice(1))
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity
    }
    return HTML_ENTITIES[body.toLowerCase()] ?? entity
  })
}

/**
 * The file name a reference names, as the format's "Media and references" rule reads it:
 * HTML-unescaped, then percent-decoded. `null` for a reference the rule ignores (`://`, a leading
 * `/`, `data:`, a `{{` template tag) or that is not a bare file name.
 */
export function mediaName(raw: string): string | null {
  const unescaped = unescapeHtml(raw.trim())
  let name = unescaped
  try {
    name = decodeURIComponent(unescaped)
  } catch {
    // Kept as written: a lone `%` is a valid character of a file name.
  }
  if (!name || name.includes('{{') || raw.includes('{{')) return null
  if (name.includes('://') || name.startsWith('/') || name.toLowerCase().startsWith('data:'))
    return null
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') return null
  return name
}

// The format's reference patterns: src="X", src='X', src=X, [sound:X] and url(X), quotes optional.
// `src` keeps a regular expression (its unquoted form needs no terminator, so it never rescans);
// `[sound:…]` and `url(…)` are linear scanners, since their patterns rescanned the rest of the text
// from every opening that is never closed (quadratic on a crafted stylesheet or field).
const SRC = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi

/** A reference found in a text: its whole span and the raw name, as written. */
export interface Reference {
  start: number
  end: number
  raw: string
}

const SOUND_OPEN = '[sound:'

/** The `[sound:X]` tags of a text, as `/\[sound:([^\]]*)\]/g` matches them, in linear time. */
export function soundReferences(text: string): Reference[] {
  const found: Reference[] = []
  let from = 0
  for (;;) {
    const start = text.indexOf(SOUND_OPEN, from)
    if (start === -1) break
    const close = text.indexOf(']', start + SOUND_OPEN.length)
    // No `]` ahead: no later tag can be closed either.
    if (close === -1) break
    found.push({ start, end: close + 1, raw: text.slice(start + SOUND_OPEN.length, close) })
    from = close + 1
  }
  return found
}

const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char)
const isWordChar = (char: string | undefined) => char !== undefined && /\w/.test(char)
const endsUnquoted = (char: string | undefined) =>
  char === undefined || char === ')' || char === '"' || char === "'" || isSpace(char)

/**
 * The `url(X)` references of a stylesheet, as `/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi`
 * matches them, in linear time: an unquoted name's end, and whether `)` follows it, are remembered,
 * so the many openings of one unclosed run share a single scan.
 */
export function urlReferences(text: string): Reference[] {
  const found: Reference[] = []
  const candidates = /url\(/gi
  // [runFrom, runEnd) holds no character ending an unquoted name.
  let runFrom = -1
  let runEnd = -1
  const unquotedEnd = (from: number): number => {
    if (runFrom !== -1 && runFrom <= from && from <= runEnd) return runEnd
    let at = from
    while (!endsUnquoted(text[at])) at++
    runFrom = from
    runEnd = at
    return at
  }
  // The position of `)` after optional spaces from a position, or -1; remembered per position.
  const closings = new Map<number, number>()
  const closingAfter = (from: number): number => {
    const known = closings.get(from)
    if (known !== undefined) return known
    let at = from
    while (isSpace(text[at])) at++
    const result = text[at] === ')' ? at : -1
    closings.set(from, result)
    return result
  }
  for (let match = candidates.exec(text); match; match = candidates.exec(text)) {
    const start = match.index
    if (isWordChar(text[start - 1])) continue
    let at = start + match[0].length
    while (isSpace(text[at])) at++
    const quote = text[at]
    let raw: string | null = null
    let close = -1
    if (quote === '"' || quote === "'") {
      const end = text.indexOf(quote, at + 1)
      if (end !== -1) {
        close = closingAfter(end + 1)
        if (close !== -1) raw = text.slice(at + 1, end)
      }
    } else {
      const end = unquotedEnd(at)
      close = closingAfter(end)
      if (close !== -1) raw = text.slice(at, end)
    }
    if (raw === null) continue
    found.push({ start, end: close + 1, raw })
    candidates.lastIndex = close + 1
  }
  return found
}

/** The media file names referred to in a text (HTML or CSS), in order, decoded. */
export function mediaReferences(text: string): string[] {
  const names: string[] = []
  const add = (raw: string | undefined) => {
    const name = raw === undefined ? null : mediaName(raw)
    if (name !== null) names.push(name)
  }
  for (const match of text.matchAll(SRC)) add(match[1] ?? match[2] ?? match[3])
  for (const reference of soundReferences(text)) add(reference.raw)
  for (const reference of urlReferences(text)) add(reference.raw)
  return names
}

/**
 * The preview of a checked `deck.json`: at most five notes, one per notetype first (to show the
 * variety), then the next ones in file order; the notetypes they use; and the listed media files
 * they refer to. Read defensively: anything malformed is left out, never an error.
 */
export function previewOf(deckJson: unknown): DeckPreview {
  const notetypes = new Map<string, Notetype>()
  for (const value of list(get(deckJson, 'notetypes'))) {
    const notetype = toNotetype(value)
    if (!notetype || notetypes.has(notetype.id)) continue
    const texts = [notetype.css, ...notetype.templates.flatMap((t) => [t.front, t.back])]
    if (texts.some((text) => text.length > MAX_PREVIEW_TEXT_CHARS)) continue
    notetypes.set(notetype.id, notetype)
  }
  const notes = list(get(deckJson, 'notes'))
    .map(toNote)
    .filter((note): note is Note => note !== null && notetypes.has(note.notetype))
    .filter((note) => JSON.stringify(note.fields).length <= MAX_PREVIEW_TEXT_CHARS)

  const chosen: Note[] = []
  const seen = new Set<string>()
  for (const note of notes) {
    if (chosen.length >= PREVIEW_NOTES) break
    if (seen.has(note.notetype)) continue
    seen.add(note.notetype)
    chosen.push(note)
  }
  for (const note of notes) {
    if (chosen.length >= PREVIEW_NOTES) break
    if (!chosen.includes(note)) chosen.push(note)
  }

  const used = [...notetypes.values()].filter((notetype) =>
    chosen.some((note) => note.notetype === notetype.id),
  )
  const listed = new Set(
    list(get(deckJson, 'media'))
      .map((file) => get(file, 'filename'))
      .filter(isString),
  )
  const texts = [
    ...chosen.flatMap((note) => Object.values(note.fields)),
    ...used.flatMap((notetype) => [
      notetype.css,
      ...notetype.templates.flatMap((template) => [template.front, template.back]),
    ]),
  ]
  const media = [...new Set(texts.flatMap(mediaReferences))]
    .filter((name) => listed.has(name))
    .sort()
  const language = strings(get(get(deckJson, 'deck'), 'language'))[0]
  return { notetypes: used, notes: chosen, media, ...(language ? { language } : {}) }
}

/** A preview read back from storage, or `null` when it is missing or malformed. */
export function parsePreview(value: unknown): DeckPreview | null {
  const rawNotetypes = get(value, 'notetypes')
  const rawNotes = get(value, 'notes')
  const rawMedia = get(value, 'media')
  if (!Array.isArray(rawNotetypes) || !Array.isArray(rawNotes) || !Array.isArray(rawMedia))
    return null
  const notetypes = rawNotetypes.map(toNotetype)
  const notes = rawNotes.map(toNote)
  if (notetypes.some((n) => n === null) || notes.some((n) => n === null)) return null
  const language = get(value, 'language')
  return {
    notetypes: notetypes.filter((n): n is Notetype => n !== null),
    notes: notes.filter((n): n is Note => n !== null),
    media: strings(rawMedia),
    ...(isString(language) ? { language } : {}),
  }
}
