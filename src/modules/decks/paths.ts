/** The author space, under the account pages of the `accounts` module (same path in both languages). */
export const authorSpacePath = (locale: string) => `/${locale}/compte/decks`
export const authorDeckPath = (locale: string, deckId: string) =>
  `${authorSpacePath(locale)}/${encodeURIComponent(deckId)}`

/** The public catalogue (same path in both languages). */
export const cataloguePath = (locale: string) => `/${locale}/decks`
/** A deck's public page: `/{locale}/d/<handle>/<deck-id>`. */
export { deckPagePath } from './domain/serving'
