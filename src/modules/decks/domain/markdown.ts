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

// Inline constructs, tried at each position in this order.
const INLINE: [RegExp, (match: RegExpExecArray) => Inline[]][] = [
  [/^`([^`]+)`/, (m) => [{ kind: 'code', text: m[1] ?? '' }]],
  [
    /^\[([^\]]*)\]\(([^)\s]*)\)/,
    (m) => {
      const content = parseInline(m[1] ?? '')
      const href = m[2] ?? ''
      return isSafeHref(href) ? [{ kind: 'link', href, content }] : content
    },
  ],
  [/^\*\*(?=\S)([\s\S]*?\S)\*\*/, (m) => [{ kind: 'strong', content: parseInline(m[1] ?? '') }]],
  [/^__(?=\S)([\s\S]*?\S)__/, (m) => [{ kind: 'strong', content: parseInline(m[1] ?? '') }]],
  [/^\*(?=\S)([\s\S]*?\S)\*/, (m) => [{ kind: 'em', content: parseInline(m[1] ?? '') }]],
  [
    /^_(?=\S)([\s\S]*?\S)_(?![A-Za-z0-9])/,
    (m) => [{ kind: 'em', content: parseInline(m[1] ?? '') }],
  ],
]

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let pending = ''
  let i = 0
  outer: while (i < text.length) {
    const char = text[i] ?? ''
    if ('`[*_'.includes(char)) {
      const rest = text.slice(i)
      for (const [pattern, build] of INLINE) {
        const match = pattern.exec(rest)
        if (!match) continue
        if (pending) out.push({ kind: 'text', text: pending })
        pending = ''
        out.push(...build(match))
        i += match[0].length
        continue outer
      }
    }
    pending += char
    i++
  }
  if (pending) out.push({ kind: 'text', text: pending })
  return out
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const NUMBERED = /^\s*\d{1,9}[.)]\s+(.*)$/
const FENCE = /^\s*(```|~~~)/

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
      blocks.push({ kind: 'heading', level, content: parseInline(heading[2] ?? '') })
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
  return parseMarkdown(markdown)
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
