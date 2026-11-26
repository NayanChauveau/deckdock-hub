/** The author space, under the account pages of the `accounts` module (same path in both languages). */
export const authorSpacePath = (locale: string) => `/${locale}/compte/decks`
export const authorDeckPath = (locale: string, deckId: string) =>
  `${authorSpacePath(locale)}/${encodeURIComponent(deckId)}`
