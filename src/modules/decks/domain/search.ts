/**
 * Text folded for the catalogue search: decomposed, without its combining marks, lowercased.
 * `Être` and `etre` fold alike, so the database compares folded texts without an extension.
 */
export const foldSearch = (text: string): string =>
  text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().normalize('NFC')

/** What the catalogue searches in one version: its name and description, folded. */
export const searchText = (name: string, description: string | null): string =>
  foldSearch(description ? `${name}\n${description}` : name)

/** Longest query searched; the rest is ignored. */
export const MAX_QUERY_LENGTH = 100
