/**
 * What one author may store on the hub. The disk of the VPS is shared: these bounds keep one
 * account from filling it (the operator still watches the disk, see OPERATIONS.md).
 */

/** Decks one author may create, whatever their status. */
export const MAX_DECKS_PER_AUTHOR = 10

/** Versions a deck still awaiting approval may receive, all editions together. */
export const MAX_PENDING_DECK_VERSIONS = 3

/**
 * Bytes stored for one author (2 GiB): the size of every file of every version of their decks,
 * each version counted with all its files (the blobs shared by content are not deducted).
 */
export const MAX_AUTHOR_STORED_BYTES = 2 * 1024 * 1024 * 1024
