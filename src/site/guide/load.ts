import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { guideSlugs } from '@/core/i18n/guide'
import type { Locale } from '@/core/i18n/locales'
import { renderGuideMarkdown } from './render'

/** content/guide/<locale>/<slug>.md, read from the server's working directory (the Dockerfile copies it). */
const directory = join(process.cwd(), 'content', 'guide')

interface Rendered {
  title: string
  summary: string
  html: string
}

const cache = new Map<string, Rendered>()

/** A page of `guideSlugs`, rendered once per process (on every read in development, to see edits). */
function read(locale: Locale, slug: string): Rendered {
  const key = `${locale}/${slug}`
  const cached = cache.get(key)
  if (cached) return cached
  const rendered = renderGuideMarkdown(
    readFileSync(join(directory, locale, `${slug}.md`), 'utf8'),
    locale,
  )
  if (process.env.NODE_ENV !== 'development') cache.set(key, rendered)
  return rendered
}

/** The guide's table of contents in `locale`, in order. */
export function guidePages(locale: Locale): { slug: string; title: string; summary: string }[] {
  return guideSlugs.map((pair) => {
    const { title, summary } = read(locale, pair[locale])
    return { slug: pair[locale], title, summary }
  })
}

/**
 * One page of the guide, or null for a slug that is not one of `locale`'s (only the slugs of
 * `guideSlugs` are ever read from disk). `other` is the same page's slug in the other language.
 */
export function guidePage(
  locale: Locale,
  slug: string,
): { title: string; html: string; other: string } | null {
  const pair = guideSlugs.find((entry) => entry[locale] === slug)
  if (!pair) return null
  const { title, html } = read(locale, slug)
  return { title, html, other: pair[locale === 'fr' ? 'en' : 'fr'] }
}
