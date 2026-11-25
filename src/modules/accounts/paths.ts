/** The visitor account pages, under the same path in both languages (like `commande/`). */
export const accountPath = (locale: string) => `/${locale}/compte`
export const signInPath = (locale: string) => `/${locale}/compte/connexion`
export const deletedPath = (locale: string) => `/${locale}/compte/supprime`

/** The `error` of a deletion link that deleted nothing (no session, used or expired). */
export const deletionLinkError = 'deletion_link'

/** The `error` of a deletion link refused by Better Auth's rate limit. */
export const tooManyError = 'too_many'

/** The errors a deletion link brings back to the account pages. */
export type DeletionLinkError = typeof deletionLinkError | typeof tooManyError

/** The deletion-link error of an address's `error`, if it is one. */
export const asDeletionLinkError = (error: string | undefined): DeletionLinkError | undefined =>
  error === deletionLinkError || error === tooManyError ? error : undefined
