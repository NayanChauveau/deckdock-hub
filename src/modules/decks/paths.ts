/** The author space, under the account pages of the `accounts` module (same path in both languages). */
export const authorSpacePath = (locale: string) => `/${locale}/compte/decks`
export const authorDeckPath = (locale: string, deckId: string) =>
  `${authorSpacePath(locale)}/${encodeURIComponent(deckId)}`

/** The public catalogue (same path in both languages). */
export const cataloguePath = (locale: string) => `/${locale}/decks`
/** A deck's public page: `/{locale}/d/<handle>/<deck-id>`. */
export { deckPagePath } from './domain/serving'

/**
 * The author guide (the site's « Guide » section, src/site): a module cannot import the site layer,
 * so its addresses are written here too, as in src/site/SiteChrome.tsx's siteLinks.
 */
export const guidePath = (locale: string) => `/${locale}/guide`
export const publishGuidePath = (locale: string) =>
  locale === 'fr' ? '/fr/guide/publier-avec-github' : '/en/guide/publish-with-github'
