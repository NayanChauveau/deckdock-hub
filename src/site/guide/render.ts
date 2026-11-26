import markdownit, { type MarkdownIt, type Token } from 'markdown-it'
import type { Locale } from '@/core/i18n/locales'

const copyLabel: Record<Locale, string> = { fr: 'Copier', en: 'Copy' }

/** `> **Note**` and `> **Attention**` (and their English or near names) open a callout. */
const callouts: Record<string, 'note' | 'warning'> = {
  note: 'note',
  astuce: 'note',
  tip: 'note',
  attention: 'warning',
  warning: 'warning',
  important: 'warning',
}

/** Screenshot placeholders the owner fills in later: dropped, never shown (raw HTML is escaped). */
const CAPTURE = /^[ \t]*<!-- capture: [^\n]*?-->[ \t]*$/gm

/** A heading's anchor: lowercase ASCII words joined by dashes (« Créer un compte » → creer-un-compte). */
function slugify(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

/** A token's attribute as a string ('' when absent). */
const attribute = (token: Token | undefined, name: string) => String(token?.attrGet(name) ?? '')

const plain = (token: Token | undefined) =>
  (token?.children ?? [])
    .map((child) => (child.type === 'text' || child.type === 'code_inline' ? child.content : ''))
    .join('')

/**
 * The guide's Markdown renderer: CommonMark and tables, **raw HTML off** (markdown-it escapes it:
 * the pages are rendered on the server and inserted as they are, under the site's CSP), links
 * validated by markdown-it (no `javascript:`), other origins with `rel="noopener noreferrer"`,
 * images from `public/guide/` only.
 */
function renderer(locale: Locale) {
  const md = markdownit({ html: false, linkify: false, typographer: false })
  const rules = md.renderer.rules

  rules['link_open'] = (tokens, index, options, _env, self) => {
    const token = tokens[index]
    if (token && /^https?:\/\//i.test(attribute(token, 'href')))
      token.attrSet('rel', 'noopener noreferrer')
    return self.renderToken(tokens, index, options)
  }

  rules['image'] = (tokens, index) => {
    const token = tokens[index]
    const src = attribute(token, 'src')
    const alt = md.utils.escapeHtml(plain(token))
    if (!/^\/guide\/[\w./-]+$/.test(src) || src.includes('..')) return alt
    return `<img src="${md.utils.escapeHtml(src)}" alt="${alt}" loading="lazy" decoding="async">`
  }

  rules['fence'] = (tokens, index) => {
    const token = tokens[index]
    const language = /^[\w-]+/.exec(token?.info.trim() ?? '')?.[0]
    const className = language ? ` class="language-${language}"` : ''
    const code = md.utils.escapeHtml(token?.content ?? '')
    // Hidden until the page's script (GuideCopy) can make it work.
    return `<div class="guide-code"><pre><code${className}>${code}</code></pre><button type="button" class="guide-copy" data-guide-copy hidden>${copyLabel[locale]}</button></div>\n`
  }

  rules['table_open'] = () => '<div class="guide-table"><table>\n'
  rules['table_close'] = () => '</table></div>\n'

  rules['heading_close'] = (tokens, index, options, _env, self) => {
    const open = tokens[index - 2]
    const id = attribute(open, 'id')
    const anchor = id
      ? `<a class="heading-anchor" href="#${id}"><span aria-hidden="true">#</span><span class="sr-only">${
          locale === 'fr' ? 'Lien vers cette section' : 'Link to this section'
        }</span></a>`
      : ''
    return `${anchor}${self.renderToken(tokens, index, options)}`
  }
  return md
}

const renderers: Partial<Record<Locale, MarkdownIt>> = {}

/** Ids for h2 and h3 (unique in the page), callout blockquotes as `<div role="note">`. */
function decorate(tokens: Token[]) {
  // `main` is the page's own landmark (the skip link's target): a heading never takes it.
  const seen = new Map<string, number>([['main', 1]])
  tokens.forEach((token, index) => {
    if (token.type === 'heading_open' && (token.tag === 'h2' || token.tag === 'h3')) {
      const base = slugify(plain(tokens[index + 1]))
      const count = (seen.get(base) ?? 0) + 1
      seen.set(base, count)
      token.attrSet('id', count === 1 ? base : `${base}-${count}`)
    }
    if (token.type !== 'blockquote_open') return
    const first = (tokens[index + 2]?.children ?? []).filter(
      (child) => child.type !== 'text' || child.content !== '',
    )
    const label = first[0]?.type === 'strong_open' ? first[1]?.content.trim().toLowerCase() : ''
    const kind = label ? callouts[label] : undefined
    if (!kind) return
    let depth = 0
    for (let end = index; end < tokens.length; end++) {
      const current = tokens[end]
      if (!current) break
      if (current.type === 'blockquote_open') depth++
      if (current.type === 'blockquote_close' && --depth === 0) {
        current.tag = 'div'
        break
      }
    }
    token.tag = 'div'
    token.attrSet('class', `callout callout-${kind}`)
    token.attrSet('role', 'note')
  })
}

/**
 * One guide page: its title (the first `# ` heading, which the page shows itself), its body as
 * HTML without that heading, and its summary (the first paragraph, as plain text).
 */
export function renderGuideMarkdown(
  source: string,
  locale: Locale,
): { title: string; summary: string; html: string } {
  const md = (renderers[locale] ??= renderer(locale))
  const tokens = md.parse(source.replace(CAPTURE, ''), {})
  let title = ''
  const start = tokens.findIndex((token) => token.type === 'heading_open' && token.tag === 'h1')
  if (start >= 0) {
    title = plain(tokens[start + 1])
    tokens.splice(start, 3)
  }
  const paragraph = tokens.findIndex((token) => token.type === 'paragraph_open')
  const summary = paragraph >= 0 ? plain(tokens[paragraph + 1]) : ''
  decorate(tokens)
  return { title, summary, html: md.renderer.render(tokens, md.options, {}) }
}
