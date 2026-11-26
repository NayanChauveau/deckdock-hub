import { isEditionCode } from '../domain/edition'
import { validateDeckId, validateHandle } from '../domain/handle'
import type { RecordId } from '../domain/model'
import { parsePreview, type DeckPreview } from '../domain/preview'
import { foldSearch, MAX_QUERY_LENGTH } from '../domain/search'
import { deckPagePath, editionAddress, previewPath, servePath } from '../domain/serving'
import type { DeckStatus } from '../domain/status'
import { cardDocument, previewCSP, renderCard } from './preview'

/** Decks per catalogue page. */
export const CATALOGUE_PAGE_SIZE = 20

/** What the catalogue shows of one edition, from its latest version's summary. */
export interface EditionCard {
  code: string
  name: string
  description: string | null
  languages: string[]
}

/** One approved deck matching a search, with all its editions. */
export interface CatalogueEntry {
  handle: string
  deckId: string
  /** The latest version received among its editions. */
  updatedAt: Date
  editions: EditionCard[]
}

/** One edition on the deck page: its latest version, its history (newest first). */
export interface PublicEdition extends EditionCard {
  license: string | null
  homepage: string | null
  notes: number
  version: string
  receivedAt: Date
  versions: { version: string; receivedAt: Date; notes: number }[]
  /** Notes of the latest version's preview. */
  previews: number
}

export interface CatalogueStore {
  /**
   * Approved decks with an edition whose latest version's folded search text contains `query`
   * (all when empty) and whose languages include `language` (a primary subtag; all when empty);
   * most recently updated first.
   */
  search(input: {
    query: string
    language: string
    offset: number
    limit: number
  }): Promise<{ total: number; decks: CatalogueEntry[] }>
  /** Primary language subtags of the approved decks' latest versions, sorted. */
  languages(): Promise<string[]>
  deck(
    handle: string,
    deckId: string,
  ): Promise<{ id: RecordId; status: DeckStatus; customerId: RecordId | null } | null>
  /** The deck's editions that have a latest version (any order). */
  editions(deck: RecordId): Promise<PublicEdition[]>
  /** The stored preview of the edition's latest version (unparsed), or `null`. */
  preview(deck: RecordId, edition: string): Promise<unknown>
}

export interface CatalogueDeps {
  store: CatalogueStore
  /** The hub's public origin (`serverURL`): addresses and media URLs are absolute. */
  origin: string
}

/** The signed-in visitor's `customers` id, read only when a pending deck needs it. */
export type Viewer = () => Promise<RecordId | null>

const primary = (language: string) => language.toLowerCase().split('-')[0] ?? ''
const speaks = (edition: EditionCard, locale: string) =>
  edition.languages.some((language) => primary(language) === locale)
const byCode = <T extends { code: string }>(editions: readonly T[]): T[] =>
  [...editions].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))

/** The edition in the visitor's language, otherwise the first by code; `null` without any. */
export function defaultEdition<T extends EditionCard>(
  editions: readonly T[],
  locale: string,
): T | null {
  const sorted = byCode(editions)
  return sorted.find((edition) => speaks(edition, locale)) ?? sorted[0] ?? null
}

const LANGUAGE = /^[a-z]{2,3}$/
const positive = (raw: string | undefined): number => {
  const value = raw && /^[1-9]\d{0,5}$/.test(raw) ? Number(raw) : 1
  return value
}

export interface CatalogueCard {
  handle: string
  deckId: string
  href: string
  name: string
  description: string | null
  languages: string[]
  editions: string[]
  updatedAt: Date
}

export interface CataloguePage {
  /** The query as typed (trimmed), for the search field. */
  query: string
  language: string
  page: number
  pageCount: number
  total: number
  languages: string[]
  decks: CatalogueCard[]
}

/**
 * `/{locale}/decks?q=&lang=&page=`: approved decks only, 20 per page, searched without case or
 * accents in the name and description, filtered on the editions' languages. One line per deck,
 * showing the edition in the visitor's language, otherwise the first by code.
 */
export async function catalogue(
  deps: CatalogueDeps,
  input: {
    q: string | undefined
    lang: string | undefined
    page: string | undefined
    locale: string
  },
): Promise<CataloguePage> {
  const query = (input.q ?? '').trim().slice(0, MAX_QUERY_LENGTH)
  const lower = (input.lang ?? '').trim().toLowerCase()
  const language = LANGUAGE.test(lower) ? lower : ''
  const page = positive(input.page)
  const [found, languages] = await Promise.all([
    deps.store.search({
      query: foldSearch(query),
      language,
      offset: (page - 1) * CATALOGUE_PAGE_SIZE,
      limit: CATALOGUE_PAGE_SIZE,
    }),
    deps.store.languages(),
  ])
  const decks = found.decks.flatMap((entry): CatalogueCard[] => {
    const shown = defaultEdition(entry.editions, input.locale)
    if (!shown) return []
    return [
      {
        handle: entry.handle,
        deckId: entry.deckId,
        href: deckPagePath(input.locale, entry.handle, entry.deckId),
        name: shown.name,
        description: shown.description,
        languages: shown.languages,
        editions: byCode(entry.editions).map((edition) => edition.code),
        updatedAt: entry.updatedAt,
      },
    ]
  })
  return {
    query,
    language,
    page,
    pageCount: Math.ceil(found.total / CATALOGUE_PAGE_SIZE),
    total: found.total,
    languages,
    decks,
  }
}

type Access =
  { kind: 'missing' } | { kind: 'gone' } | { kind: 'open'; id: RecordId; status: DeckStatus }

/**
 * Who may see a deck by its public address: anyone when approved, only its author while pending
 * (otherwise it does not exist), nobody once hidden (gone).
 */
async function access(
  deps: CatalogueDeps,
  handle: string,
  deckId: string,
  viewer: Viewer,
): Promise<Access> {
  const validHandle = validateHandle(handle)
  if (!validHandle.ok || validHandle.value !== handle) return { kind: 'missing' }
  if (!validateDeckId(deckId).ok) return { kind: 'missing' }
  const deck = await deps.store.deck(handle, deckId)
  if (!deck) return { kind: 'missing' }
  if (deck.status === 'hidden') return { kind: 'gone' }
  if (deck.status === 'pending') {
    const customer = await viewer()
    if (customer === null || customer !== deck.customerId) return { kind: 'missing' }
  }
  return { kind: 'open', id: deck.id, status: deck.status }
}

export type DeckPageResult =
  | { kind: 'missing' }
  | { kind: 'gone' }
  | {
      kind: 'found'
      handle: string
      deckId: string
      status: DeckStatus
      /** Sorted by code. */
      editions: PublicEdition[]
      edition: PublicEdition
      /** The add-on address of an edition: `<base>/<edition>/`. */
      address: (code: string) => string
      /** The preview route of the shown edition's note `index`, one side. */
      preview: (index: number, side: 'front' | 'back') => string
    }

/**
 * `/{locale}/d/<handle>/<deck-id>?edition=`: the deck and its editions; the shown edition is the
 * one asked for, otherwise the visitor's language, otherwise the first by code.
 */
export async function deckPage(
  deps: CatalogueDeps,
  input: {
    handle: string
    deckId: string
    edition: string | undefined
    locale: string
    viewer: Viewer
  },
): Promise<DeckPageResult> {
  const deck = await access(deps, input.handle, input.deckId, input.viewer)
  if (deck.kind !== 'open') return deck
  const editions = byCode(await deps.store.editions(deck.id))
  const edition =
    editions.find((candidate) => candidate.code === input.edition) ??
    defaultEdition(editions, input.locale)
  if (!edition) return { kind: 'missing' }
  const { handle, deckId } = input
  return {
    kind: 'found',
    handle,
    deckId,
    status: deck.status,
    editions,
    edition,
    address: (code) => editionAddress(deps.origin, handle, deckId, code),
    preview: (index, side) => previewPath(handle, deckId, edition.code, index, side),
  }
}

export type PreviewResult =
  { kind: 'missing' } | { kind: 'card'; html: string; csp: string; public: boolean }

const INDEX = /^(0|[1-9]\d{0,2})$/

/**
 * `/preview/<handle>/<deck-id>/<edition>/<note>/<side>`: one side of a preview note of the
 * edition's latest version, as a whole document, with its policy. `public` says whether it may be
 * cached by anyone (approved deck) or only shown to the pending deck's author.
 */
export async function previewCard(
  deps: CatalogueDeps,
  input: {
    handle: string
    deckId: string
    edition: string
    index: string
    side: string
    viewer: Viewer
  },
): Promise<PreviewResult> {
  const missing = { kind: 'missing' } as const
  if (!isEditionCode(input.edition) || !INDEX.test(input.index)) return missing
  if (input.side !== 'front' && input.side !== 'back') return missing
  const deck = await access(deps, input.handle, input.deckId, input.viewer)
  if (deck.kind !== 'open') return missing
  const preview: DeckPreview | null = parsePreview(await deps.store.preview(deck.id, input.edition))
  const note = preview?.notes[Number(input.index)]
  const notetype = preview?.notetypes.find((candidate) => candidate.id === note?.notetype)
  if (!preview || !note || !notetype) return missing
  const origin = deps.origin.replace(/\/+$/, '')
  const mediaBase = `${origin}${servePath(input.handle, input.deckId, input.edition, 'media')}/`
  const listed = new Set(preview.media)
  const media = (name: string) =>
    listed.has(name)
      ? `${origin}${servePath(input.handle, input.deckId, input.edition, 'media', name)}`
      : ''
  const html = cardDocument(notetype, renderCard(notetype, note, 0, input.side, media), media, {
    mediaBase,
    lang: preview.language,
    title: notetype.name,
  })
  return {
    kind: 'card',
    html,
    csp: previewCSP(mediaBase),
    public: deck.status === 'approved',
  }
}

/** Whether the deck at this public address was hidden (its page says it was withdrawn). */
export async function deckGone(
  deps: CatalogueDeps,
  input: { handle: string; deckId: string },
): Promise<boolean> {
  return (
    (await access(deps, input.handle, input.deckId, () => Promise.resolve(null))).kind === 'gone'
  )
}
