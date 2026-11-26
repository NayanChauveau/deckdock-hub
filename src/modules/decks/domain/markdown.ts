/**
 * A small Markdown reader for deck descriptions ("Short Markdown" in the format). It produces a
 * tree, never HTML: the page renders the tree as React elements, so raw HTML in a description is
 * plain text and only http(s) and mailto links survive.
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; content: Inline[] }
  | { kind: 'em'; content: Inline[] }
  | { kind: 'link'; href: string; content: Inline[] }

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: Inline[] }
  | { kind: 'paragraph'; content: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'codeblock'; text: string }
  | { kind: 'quote'; content: Inline[] }

/** A link target kept as a link; anything else (javascript:, data:, relative) becomes text. */
export const isSafeHref = (href: string): boolean => /^(https?:\/\/|mailto:)/i.test(href)

/** Longest description rendered on a deck page; the rest is cut, with a note. */
export const MAX_DESCRIPTION_CHARS = 20_000
/** Longest part of a description read for a summary or a meta description. */
export const MAX_SUMMARY_SOURCE_CHARS = 2_000
/** Marks nested deeper than this are kept as their text. */
const MAX_DEPTH = 4

/**
 * The first `max` UTF-16 units of a text, one fewer when the last kept unit is a high surrogate:
 * a cut never leaves half of a character (an emoji, a rare ideogram) at the end.
 */
function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const last = text.charCodeAt(max - 1)
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max)
}

/** A description cut to `max` characters, and whether it was. */
export function truncateDescription(
  source: string,
  max = MAX_DESCRIPTION_CHARS,
): { text: string; truncated: boolean } {
  return source.length > max
    ? { text: cut(source, max), truncated: true }
    : { text: source, truncated: false }
}

const isSpace = (char: string | undefined) => char === undefined || /\s/.test(char)
const isWordChar = (char: string | undefined) => char !== undefined && /[A-Za-z0-9]/.test(char)

/**
 * Finds closing delimiters in one text, forward only. A search is remembered per delimiter: the
 * next search from a later position reuses it when the remembered closer is still ahead, so each
 * delimiter scans the text once whatever the input (no quadratic rescans).
 */
function closers(text: string) {
  const memo = new Map<string, { from: number; at: number }>()
  return (needle: string, from: number, valid: (at: number) => boolean = () => true): number => {
    const known = memo.get(needle)
    if (known && known.from <= from && (known.at === -1 || known.at >= from)) return known.at
    let at = text.indexOf(needle, from)
    while (at !== -1 && !valid(at)) at = text.indexOf(needle, at + 1)
    memo.set(needle, { from, at })
    return at
  }
}

/**
 * Inline marks: `code`, [links](https://…), **strong**, __strong__, *em*, _em_. One pass over the
 * text; each closing delimiter is found from the current position and never searched again.
 */
export function parseInline(text: string, depth = 0): Inline[] {
  if (depth > MAX_DEPTH) return text ? [{ kind: 'text', text }] : []
  const out: Inline[] = []
  const next = closers(text)
  // The next whitespace from a position, remembered like the closers.
  let spaceFrom = -1
  let spaceAt = -1
  const nextSpace = (from: number): number => {
    if (spaceFrom !== -1 && spaceFrom <= from && (spaceAt === -1 || spaceAt >= from)) return spaceAt
    let at = from
    while (at < text.length && !isSpace(text[at])) at++
    spaceFrom = from
    spaceAt = at < text.length ? at : -1
    return spaceAt
  }
  // A link's verdict by its closing bracket: many `[` may share one `]`.
  const links = new Map<number, number>()
  const inner = (from: number, to: number) => parseInline(text.slice(from, to), depth + 1)
  let pending = ''
  let i = 0
  const emit = (nodes: Inline[], to: number) => {
    if (pending) out.push({ kind: 'text', text: pending })
    pending = ''
    out.push(...nodes)
    i = to
  }
  while (i < text.length) {
    const char = text[i] ?? ''
    if (char === '`') {
      const close = next('`', i + 1)
      if (close > i + 1) {
        emit([{ kind: 'code', text: text.slice(i + 1, close) }], close + 1)
        continue
      }
    } else if (char === '[') {
      const bracket = next(']', i + 1)
      if (bracket !== -1) {
        let paren = links.get(bracket)
        if (paren === undefined) {
          paren = -1
          if (text[bracket + 1] === '(') {
            // Both searches are remembered: many links may share one `)` or one space.
            const close = next(')', bracket + 2)
            const space = nextSpace(bracket + 2)
            if (close !== -1 && (space === -1 || space > close)) paren = close
          }
          links.set(bracket, paren)
        }
        if (paren !== -1) {
          const href = text.slice(bracket + 2, paren)
          const content = inner(i + 1, bracket)
          emit(isSafeHref(href) ? [{ kind: 'link', href, content }] : content, paren + 1)
          continue
        }
      }
    } else if (char === '*' || char === '_') {
      const double = text[i + 1] === char
      const mark = double ? char + char : char
      const open = i + mark.length
      if (!isSpace(text[open])) {
        const close = next(
          mark,
          open + 1,
          (at) =>
            !isSpace(text[at - 1]) &&
            (char === '*' || double || !isWordChar(text[at + mark.length])),
        )
        if (close !== -1) {
          const content = inner(open, close)
          emit([{ kind: double ? 'strong' : 'em', content }], close + mark.length)
          continue
        }
      }
    }
    pending += char
    i++
  }
  if (pending) out.push({ kind: 'text', text: pending })
  return out
}

const HEADING = /^(#{1,6})\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/
const FENCE = /^\s*(```|~~~)/

/** A heading's text without its optional closing `#`s and trailing spaces (a linear scan). */
function trimClosingHashes(text: string): string {
  let end = text.length
  while (end > 0 && (text[end - 1] === '#' || isSpace(text[end - 1]))) end--
  return text.slice(0, end)
}

/** The blocks of a Markdown text; joined lines of a paragraph are separated by a space. */
export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  const joined = (parts: string[]) => parseInline(parts.map((part) => part.trim()).join(' '))
  while (i < lines.length) {
    const line = lines[i] ?? ''
    if (!line.trim()) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const code: string[] = []
      i++
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith(fence[1] ?? '```'))
        code.push(lines[i++] ?? '')
      i++
      blocks.push({ kind: 'codeblock', text: code.join('\n') })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      const level = Math.min(6, (heading[1] ?? '#').length) as 1 | 2 | 3 | 4 | 5 | 6
      blocks.push({
        kind: 'heading',
        level,
        content: parseInline(trimClosingHashes(heading[2] ?? '')),
      })
      i++
      continue
    }
    const listPattern = BULLET.test(line) ? BULLET : NUMBERED.test(line) ? NUMBERED : null
    if (listPattern) {
      const items: Inline[][] = []
      while (i < lines.length) {
        const item = listPattern.exec(lines[i] ?? '')
        if (!item) break
        items.push(parseInline((item[1] ?? '').trim()))
        i++
      }
      blocks.push({ kind: 'list', ordered: listPattern === NUMBERED, items })
      continue
    }
    if (line.trimStart().startsWith('>')) {
      const quoted: string[] = []
      while (i < lines.length && (lines[i] ?? '').trimStart().startsWith('>'))
        quoted.push((lines[i++] ?? '').trimStart().slice(1))
      blocks.push({ kind: 'quote', content: joined(quoted) })
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length) {
      const next = lines[i] ?? ''
      if (!next.trim() || FENCE.test(next) || HEADING.test(next) || BULLET.test(next)) break
      if (NUMBERED.test(next) || next.trimStart().startsWith('>')) break
      paragraph.push(next)
      i++
    }
    blocks.push({ kind: 'paragraph', content: joined(paragraph) })
  }
  return blocks
}

const inlineText = (content: Inline[]): string =>
  content.map((node) => ('text' in node ? node.text : inlineText(node.content))).join('')

/** The text of a Markdown description without its marks (lists, summaries, meta descriptions). */
export function markdownText(markdown: string): string {
  return parseMarkdown(cut(markdown, MAX_SUMMARY_SOURCE_CHARS))
    .map((block) =>
      block.kind === 'codeblock'
        ? block.text
        : block.kind === 'list'
          ? block.items.map(inlineText).join(' ')
          : inlineText(block.content),
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
