import type { Locale } from './locales'

/**
 * The pages of the author guide (src/site/guide, content/guide/<locale>/<slug>.md), in the order of
 * its table of contents: the same page's slug in each language. The one source of the guide's
 * addresses, for the site's header and the decks module's author space alike.
 */
export const guideSlugs: readonly Record<Locale, string>[] = [
  { fr: 'comment-ca-marche', en: 'how-it-works' },
  { fr: 'publier-avec-github', en: 'publish-with-github' },
  { fr: 'publier-sans-github', en: 'publish-without-github' },
  { fr: 'format', en: 'format' },
]

/** The guide's home (`slug` absent) or one of its pages. */
export const guidePath = (locale: Locale, slug?: string) =>
  slug ? `/${locale}/guide/${slug}` : `/${locale}/guide`

/** « Publier avec GitHub, pas à pas »: where « Publier un deck » leads. */
export const publishGuidePath = (locale: Locale) =>
  guidePath(locale, locale === 'fr' ? 'publier-avec-github' : 'publish-with-github')
