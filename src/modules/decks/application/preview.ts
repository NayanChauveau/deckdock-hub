import { mediaName, type Note, type Notetype } from '../domain/preview'

/**
 * Card previews: a "best effort" rendering of Anki's template syntax, not an exact copy of Anki.
 *
 * The output is the author's HTML and JavaScript, untrusted: it is only ever served as the
 * preview route's own document (previewCSP, sandboxed without allow-same-origin) and shown in a
 * sandboxed iframe, never inserted into a page of the site.
 */

/** A media file's URL on the hub, or `''` when the name is not a file of the edition. */
export type MediaURL = (name: string) => string

/** The preview document's policy: only the hub's media, inline styles, scripts in a sandbox. */
export const previewCSP = (origin: string): string =>
  [
    "default-src 'none'",
    `img-src ${origin}`,
    `media-src ${origin}`,
    "style-src 'unsafe-inline'",
    'sandbox allow-scripts',
    // Not in the brief's policy: only the hub's own pages may frame the preview (tighter only).
    "frame-ancestors 'self'",
  ].join('; ')

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; name: string; filters: string[] }
  | { kind: 'section'; name: string; inverted: boolean; children: Node[] }

/** The template as a tree: unbalanced or stray closing tags are dropped, never an error. */
function parseTemplate(template: string): Node[] {
  const root: Node[] = []
  const stack: { name: string; inverted: boolean; children: Node[] }[] = []
  const current = () => stack.at(-1)?.children ?? root
  const pattern = /\{\{([\s\S]*?)\}\}/g
  let last = 0
  for (const match of template.matchAll(pattern)) {
    if (match.index > last)
      current().push({ kind: 'text', text: template.slice(last, match.index) })
    last = match.index + match[0].length
    const body = (match[1] ?? '').trim()
    const sigil = body[0]
    if (sigil === '#' || sigil === '^') {
      stack.push({ name: body.slice(1).trim(), inverted: sigil === '^', children: [] })
    } else if (sigil === '/') {
      const name = body.slice(1).trim()
      const at = stack.map((open) => open.name).lastIndexOf(name)
      if (at === -1) continue
      // Sections opened inside and never closed are closed with this one.
      while (stack.length > at) {
        const open = stack.pop()
        if (!open) break
        current().push({ kind: 'section', ...open })
      }
    } else {
      const parts = body.split(':').map((part) => part.trim())
      current().push({ kind: 'tag', name: parts.at(-1) ?? '', filters: parts.slice(0, -1) })
    }
  }
  if (last < template.length) current().push({ kind: 'text', text: template.slice(last) })
  // Sections never closed keep their content, as if closed at the end.
  while (stack.length) {
    const open = stack.pop()
    if (open) current().push({ kind: 'section', ...open })
  }
  return root
}

// Anki's emptiness rule: only whitespace, <br> and <div> tags.
const EMPTY = /^(?:\s|<\/?(?:br|div)\s?\/?>)*$/i
const isEmpty = (value: string) => EMPTY.test(value)

const CLOZE = /\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g

/** The lowest cloze number used in the fields, or 1. */
function firstCloze(note: Note): number {
  let lowest = Infinity
  for (const value of Object.values(note.fields))
    for (const match of value.matchAll(CLOZE)) lowest = Math.min(lowest, Number(match[1]))
  return Number.isFinite(lowest) ? lowest : 1
}

/** One cloze field: the active deletion masked on the front, revealed on the back. */
function renderCloze(value: string, active: number, side: 'front' | 'back'): string {
  return value.replace(CLOZE, (_all, n: string, text: string, hint: string | undefined) => {
    if (Number(n) !== active) return text
    if (side === 'back') return `<span class="cloze">${text}</span>`
    return `<span class="cloze">[${hint ?? '...'}]</span>`
  })
}

interface Context {
  notetype: Notetype
  note: Note
  templateName: string
  side: 'front' | 'back'
  frontSide: string
  cloze: number
}

function fieldValue(name: string, context: Context): string {
  const { note, notetype } = context
  if (Object.hasOwn(note.fields, name)) return note.fields[name] ?? ''
  if (name === 'FrontSide') return context.side === 'back' ? context.frontSide : ''
  if (name === 'Tags') return note.tags.join(' ')
  if (name === 'Type') return notetype.name
  if (name === 'Card') return context.templateName
  return ''
}

function renderNodes(nodes: Node[], context: Context): string {
  let out = ''
  for (const node of nodes) {
    if (node.kind === 'text') out += node.text
    else if (node.kind === 'section') {
      const filled = !isEmpty(fieldValue(node.name, context))
      if (filled !== node.inverted) out += renderNodes(node.children, context)
    } else {
      const value = fieldValue(node.name, context)
      // Other filters (hint, text, furigana, tts…) are dropped: the field is shown as is.
      out += node.filters.includes('cloze')
        ? renderCloze(value, context.cloze, context.side)
        : value
    }
  }
  return out
}

const escapeAttribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** `src` attributes and `[sound:…]` tags pointed at the hub; unknown files dropped. */
function rewriteMedia(html: string, media: MediaURL): string {
  return html
    .replace(
      /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
      (all, a: string | undefined, b: string | undefined, c: string | undefined) => {
        const raw = a ?? b ?? c ?? ''
        const name = mediaName(raw)
        if (name === null) return all
        return `src="${escapeAttribute(media(name))}"`
      },
    )
    .replace(/\[sound:([^\]]*)\]/g, (_all, raw: string) => {
      const name = mediaName(raw)
      const url = name === null ? '' : media(name)
      return url ? `<audio controls src="${escapeAttribute(url)}"></audio>` : ''
    })
}

/** `url(…)` of a stylesheet pointed at the hub; an unknown file becomes `url("")`. */
function rewriteCssMedia(css: string, media: MediaURL): string {
  return css.replace(
    /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s]*))\s*\)/gi,
    (all, a: string | undefined, b: string | undefined, c: string | undefined) => {
      const name = mediaName(a ?? b ?? c ?? '')
      if (name === null) return all
      return `url("${media(name).replace(/["\\\n]/g, '')}")`
    },
  )
}

/**
 * One side of the card of `templateIndex` for a note. Handles `{{Field}}`, `{{cloze:Field}}` (the
 * first deletion masked on the front, revealed on the back), `{{FrontSide}}`, `{{#Field}}…{{/Field}}`
 * and `{{^Field}}…{{/Field}}`; other filters are dropped. Field values are HTML, as in Anki, and
 * are not escaped. Media references are rewritten to `media`'s URLs.
 */
export function renderCard(
  notetype: Notetype,
  note: Note,
  templateIndex: number,
  side: 'front' | 'back',
  media: MediaURL,
): string {
  const template = notetype.templates[templateIndex]
  if (!template) return ''
  const base = {
    notetype,
    note,
    templateName: template.name,
    frontSide: '',
    cloze: firstCloze(note),
  }
  const front = renderNodes(parseTemplate(template.front), { ...base, side: 'front' })
  const html =
    side === 'front'
      ? front
      : renderNodes(parseTemplate(template.back), { ...base, side: 'back', frontSide: front })
  return rewriteMedia(html, media)
}

/** The preview route's document: the notetype's CSS (media rewritten) and the rendered card. */
export function cardDocument(notetype: Notetype, html: string, media: MediaURL): string {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<style>${rewriteCssMedia(notetype.css, media)}</style>`,
    `</head><body class="card">${html}</body></html>`,
  ].join('')
}
