import { validateDeckId, validateHandle } from '../domain/handle'
import type { RecordId } from '../domain/model'
import { indexText, parseServePath, type IndexEntry } from '../domain/serving'
import type { DeckStatus } from '../domain/status'

/**
 * What serving reads: a deck by its public address, and the latest version of its editions
 * (`editions.latestVersion`). Never a version that is not an edition's latest.
 */
export interface ServeStore {
  /** The deck `deckId` of the author whose handle is `handle`, or `null`. */
  deck(handle: string, deckId: string): Promise<{ id: RecordId; status: DeckStatus } | null>
  /** One entry per edition that has a latest version (any order). */
  latestVersions(deck: RecordId): Promise<IndexEntry[]>
  /**
   * One file of the edition's latest version, by its key in the version's file map (`deck.json`,
   * `media/<file>`, compared exactly), or `null`. Never the whole map: an edition may list up to
   * 20 000 files, and every media request is public.
   */
  latestFile(
    deck: RecordId,
    edition: string,
    key: string,
  ): Promise<{ sha256: string; size: number } | null>
}

export interface ServeDeps {
  store: ServeStore
  /** sha256 hex of a string's UTF-8 bytes (the ETag of index.json). */
  hash: (text: string) => string
}

export interface ServeRequest {
  handle: string
  deckId: string
  /** The path below `/d/<handle>/<deck-id>/`, one percent-decoded string per segment. */
  path: string[]
}

export type ServeResult =
  /** Unknown deck, edition or file, or a malformed address: all alike (404). */
  | { kind: 'missing' }
  /** A hidden deck (410). */
  | { kind: 'gone' }
  /** index.json, built from the editions' latest versions; `sha256` is that of `text`. */
  | { kind: 'text'; text: string; sha256: string; noindex: boolean }
  /** A stored file, served from its blob: `deck.json` or one media file. */
  | {
      kind: 'blob'
      file: 'deck' | 'media'
      filename: string
      sha256: string
      size: number
      noindex: boolean
    }

const missing: ServeResult = { kind: 'missing' }

/**
 * Resolves `GET /d/<handle>/<deck-id>/<path>` in the format's "Publishing layout". A pending deck
 * is served (its author tests it by its address) but not indexed; a hidden one is gone. A media
 * file is looked up as `media/<filename>` in the version's file map, exactly as stored.
 */
export async function serveDeckFile(deps: ServeDeps, request: ServeRequest): Promise<ServeResult> {
  // Addresses are canonical: a handle is stored lowercased, so `Alice` names nothing.
  const handle = validateHandle(request.handle)
  if (!handle.ok || handle.value !== request.handle) return missing
  if (!validateDeckId(request.deckId).ok) return missing
  const target = parseServePath(request.path)
  if (!target) return missing

  const deck = await deps.store.deck(request.handle, request.deckId)
  if (!deck) return missing
  if (deck.status === 'hidden') return { kind: 'gone' }
  const noindex = deck.status === 'pending'

  if (target.kind === 'index') {
    const text = indexText(await deps.store.latestVersions(deck.id))
    return { kind: 'text', text, sha256: deps.hash(text), noindex }
  }
  const [key, filename] =
    target.kind === 'deck'
      ? ['deck.json', 'deck.json']
      : [`media/${target.filename}`, target.filename]
  const file = await deps.store.latestFile(deck.id, target.edition, key)
  if (!file) return missing
  return {
    kind: 'blob',
    file: target.kind,
    filename,
    sha256: file.sha256,
    size: file.size,
    noindex,
  }
}
