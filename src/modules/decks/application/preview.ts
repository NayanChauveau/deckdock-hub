import {
  mediaName,
  soundReferences,
  urlReferences,
  type Note,
  type Notetype,
} from '../domain/preview'

/**
 * Card previews: a "best effort" rendering of Anki's template syntax, not an exact copy of Anki.
 *
 * The output is the author's HTML and JavaScript, untrusted: it is only ever served as the
 * preview route's own document (previewCSP, sandboxed without allow-same-origin) and shown in a
 * sandboxed iframe, never inserted into a page of the site.
 */

/** A media file's URL on the hub, or `''` when the name is not a file of the edition. */
export type MediaURL = (name: string) => string

/**
 * The directives a `<meta>` can carry: nothing but the edition's media files (`mediaBase` is
 * `<origin>/d/<handle>/<deck>/<edition>/media/`), inline styles, no base URL, no form target.
 */
const directives = (mediaBase: string): string[] => [
  "default-src 'none'",
  `img-src ${mediaBase}`,
  `media-src ${mediaBase}`,
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
]

/**
 * The preview response's policy: the brief's, tightened (media path instead of the whole origin,
 * `base-uri` and `form-action`, `frame-ancestors 'self'`), with scripts in a sandbox without
 * allow-same-origin.
 */
export const previewCSP = (mediaBase: string): string =>
  [...directives(mediaBase), 'sandbox allow-scripts', "frame-ancestors 'self'"].join('; ')

/** The same policy in the document itself, should the header ever be lost (no sandbox in a meta). */
export const previewMetaCSP = (mediaBase: string): string => directives(mediaBase).join('; ')

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; name: string; filters: string[] }
  | { kind: 'section'; name: string; inverted: boolean; children: Node[] }

/**
 * The `{{…}}` tags of a template, as `/\{\{([\s\S]*?)\}\}/g` matches them (each `{{` closed by the
 * first `}}` after it), in linear time: that pattern rescanned the rest of the template from every
 * `{{` never closed.
 */
function templateTags(template: string): { start: number; end: number; body: string }[] {
  const tags: { start: number; end: number; body: string }[] = []
  let from = 0
  for (;;) {
    const start = template.indexOf('{{', from)
    if (start === -1) break
    const close = template.indexOf('}}', start + 2)
    if (close === -1) break
    tags.push({ start, end: close + 2, body: template.slice(start + 2, close) })
    from = close + 2
  }
  return tags
}

/** The template as a tree: unbalanced or stray closing tags are dropped, never an error. */
function parseTemplate(template: string): Node[] {
  const root: Node[] = []
  const stack: { name: string; inverted: boolean; children: Node[] }[] = []
  const current = () => stack.at(-1)?.children ?? root
  let last = 0
  for (const tag of templateTags(template)) {
    if (tag.start > last) current().push({ kind: 'text', text: template.slice(last, tag.start) })
    last = tag.end
    const body = tag.body.trim()
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

interface Deletion {
  start: number
  end: number
  number: number
  text: string
  hint: string | undefined
}

const isDigit = (code: number) => code >= 48 && code <= 57

/**
 * The cloze deletions of a field, as `/\{\{c(\d+)::([\s\S]*?)(?:::([\s\S]*?))?\}\}/g` matches them,
 * in linear time (that pattern was cubic on a run of `{{c1::`): `{{c`, digits, `::`, then the first
 * `}}`; the hint is what follows the first `::` inside.
 */
function deletions(value: string): Deletion[] {
  const found: Deletion[] = []
  let from = 0
  for (;;) {
    const start = value.indexOf('{{c', from)
    if (start === -1) break
    let at = start + 3
    while (at < value.length && isDigit(value.charCodeAt(at))) at++
    if (at === start + 3 || !value.startsWith('::', at)) {
      from = start + 1
      continue
    }
    const close = value.indexOf('}}', at + 2)
    // No `}}` ahead: no later deletion can be closed either.
    if (close === -1) break
    const inner = value.slice(at + 2, close)
    const separator = inner.indexOf('::')
    found.push({
      start,
      end: close + 2,
      number: Number(value.slice(start + 3, at)),
      text: separator === -1 ? inner : inner.slice(0, separator),
      hint: separator === -1 ? undefined : inner.slice(separator + 2),
    })
    from = close + 2
  }
  return found
}

/** A text with each found span replaced. */
function replaceSpans<T extends { start: number; end: number }>(
  text: string,
  spans: T[],
  replace: (span: T) => string,
): string {
  let out = ''
  let last = 0
  for (const span of spans) {
    out += text.slice(last, span.start) + replace(span)
    last = span.end
  }
  return out + text.slice(last)
}

/** The lowest cloze number used in the fields, or 1. */
function firstCloze(note: Note): number {
  let lowest = Infinity
  for (const value of Object.values(note.fields))
    for (const deletion of deletions(value)) lowest = Math.min(lowest, deletion.number)
  return Number.isFinite(lowest) ? lowest : 1
}

/** One cloze field: the active deletion masked on the front, revealed on the back. */
function renderCloze(value: string, active: number, side: 'front' | 'back'): string {
  return replaceSpans(value, deletions(value), ({ number, text, hint }) => {
    if (number !== active) return text
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
  const withSources = html.replace(
    /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi,
    (all, a: string | undefined, b: string | undefined, c: string | undefined) => {
      const raw = a ?? b ?? c ?? ''
      const name = mediaName(raw)
      if (name === null) return all
      return `src="${escapeAttribute(media(name))}"`
    },
  )
  return replaceSpans(withSources, soundReferences(withSources), ({ raw }) => {
    const name = mediaName(raw)
    const url = name === null ? '' : media(name)
    return url ? `<audio controls src="${escapeAttribute(url)}"></audio>` : ''
  })
}

/** `url(…)` of a stylesheet pointed at the hub; an unknown file becomes `url("")`. */
function rewriteCssMedia(css: string, media: MediaURL): string {
  return replaceSpans(css, urlReferences(css), ({ start, end, raw }) => {
    const name = mediaName(raw)
    if (name === null) return css.slice(start, end)
    return `url("${media(name).replace(/["\\\n]/g, '')}")`
  })
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

const escapeText = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const LANGUAGE_TAG = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

/**
 * The preview route's document: the policy as the head's first element, the notetype's CSS (media
 * rewritten, `</style` escaped so it cannot close the element) and the rendered card. `lang` is
 * set only when it is a language tag.
 */
export function cardDocument(
  notetype: Notetype,
  html: string,
  media: MediaURL,
  options: { mediaBase: string; lang?: string | undefined; title: string },
): string {
  const lang = options.lang && LANGUAGE_TAG.test(options.lang) ? ` lang="${options.lang}"` : ''
  const css = rewriteCssMedia(notetype.css, media).replace(
    /<\/style/gi,
    (tag) => `<\\${tag.slice(1)}`,
  )
  return [
    `<!doctype html><html${lang}><head>`,
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttribute(previewMetaCSP(options.mediaBase))}">`,
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeText(options.title)}</title>`,
    `<style>${css}</style>`,
    `</head><body class="card">${html}</body></html>`,
  ].join('')
}
