import { deckFacts, isEditionCode, type DeckFacts } from '../domain/edition'
import type { RecordId } from '../domain/model'
import { previewOf, type DeckPreview } from '../domain/preview'
import { searchText } from '../domain/search'
import { findDeckByToken, recordTokenUse } from './decks'
import type { DecksDeps } from './ports'

/** One error or refusal, shown line by line by the DeckDock Action. */
export interface PublishIssue {
  where: string
  message: string
}

/** Files of an edition by relative path (`deck.json`, `media/<file>`). */
export type FileMap = Readonly<Record<string, { sha256: string; size: number }>>

/** A structure change of a notetype present in the previous and the new version. */
export interface NotetypeChange {
  notetype: string
  kind: 'appended_fields' | 'breaking'
  detail: string
}

/**
 * One upload, in a temporary directory the adapter owns. Called in this order, and `dispose`
 * always last, whatever happened.
 */
export interface EditionWorkspace {
  /** Copies the request body into the workspace; more than the upload limit is `too_large`. */
  receive(): Promise<'ok' | 'too_large'>
  /**
   * Safe extraction, then the layout of an edition: `deck.json` and `media/<file>`, nothing else.
   * `edition` is the one of the URL.
   */
  unpack(edition: string): Promise<PublishIssue[]>
  /** `deckdock check --non-strict` on the unpacked edition. */
  check(): Promise<PublishIssue[]>
  /** The parsed `deck.json` (checked). */
  deckJson(): Promise<unknown>
  files(): Promise<FileMap>
  /** The notetype changes from the stored `deck.json` with this hash to the new one. */
  compat(previousDeckJsonSha256: string): Promise<NotetypeChange[]>
  /** Stores every file of the edition, by content. */
  keep(): Promise<void>
  dispose(): Promise<void>
}

export interface PublishedEdition {
  id: RecordId
  latest: { id: RecordId; version: string; deckJsonSha256: string } | null
}

export interface StoredVersion {
  version: string
  deckJsonSha256: string
  files: FileMap
}

export interface VersionSummary {
  name: string
  description: string | null
  languages: string[]
  license: string | null
  homepage: string | null
  notes: number
  /** Bytes of all the files. */
  size: number
  /** Name and description folded for the catalogue search (domain/search.ts). */
  search: string
}

export interface NewVersion {
  deck: RecordId
  edition: string
  version: string
  summary: VersionSummary
  /** The deck page's preview: a few notes, their notetypes and media (domain/preview.ts). */
  preview: DeckPreview
  files: FileMap
  deckJsonSha256: string
  /** The latest version the checks compared against (`null`: the edition had none). */
  expectedLatest: RecordId | null
}

export interface PublishStore {
  edition(deck: RecordId, code: string): Promise<PublishedEdition | null>
  version(edition: RecordId, version: string): Promise<StoredVersion | null>
  /**
   * In one transaction that locks the edition row: the edition (created if new), the version, and
   * the edition's latest version, which becomes the new one: the latest is always the version
   * received last, in the order the lock serialises. `receivedAt` is the time the lock was
   * acquired, so the order of reception and of `latestVersion` agree. Nothing is written when the version was
   * already taken (`exists`: a concurrent publish won the unique index) or when the edition's
   * latest version is no longer `expectedLatest` (`stale`: another version was recorded since the
   * checks ran).
   */
  record(version: NewVersion): Promise<'created' | 'exists' | 'stale'>
}

export interface PublishDeps<Archive> {
  decks: DecksDeps
  store: PublishStore
  workspace: (archive: Archive) => EditionWorkspace
  /** `null` when the deck may publish now, otherwise the seconds to wait. */
  rateLimit: (deck: RecordId) => number | null
  /**
   * One of the few process-wide publish slots (uploads, extraction and the checker are costly):
   * its release function, or `null` when none freed up in time.
   */
  slot: () => Promise<(() => void) | null>
  /** Seconds a client should wait after `slot` gave up. */
  busyRetryAfter: number
  clock: () => Date
}

export type PublishStatus = 'published' | 'already_published' | 'pending_review'

/** The JSON body the DeckDock Action reads, for successes and refusals alike. */
export interface PublishBody {
  status: PublishStatus | 'rejected'
  version: string
  notes: number
  warnings: string[]
  errors: PublishIssue[]
}

export interface PublishResult {
  httpStatus: 200 | 401 | 409 | 410 | 413 | 422 | 429 | 503
  body: PublishBody
  /** Seconds, with 429 and 503. */
  retryAfter?: number
}

const refused = (
  httpStatus: Exclude<PublishResult['httpStatus'], 200>,
  errors: PublishIssue[],
  facts?: DeckFacts,
): PublishResult => ({
  httpStatus,
  body: {
    status: 'rejected',
    version: facts?.version ?? '',
    notes: facts?.notes ?? 0,
    warnings: [],
    errors,
  },
})

const accepted = (status: PublishStatus, facts: DeckFacts, warnings: string[]): PublishResult => ({
  httpStatus: 200,
  body: { status, version: facts.version, notes: facts.notes, warnings, errors: [] },
})

/** Same version, same bytes: the same paths with the same hashes. */
const sameFiles = (a: FileMap, b: FileMap) => {
  const keys = Object.keys(a).sort()
  const other = Object.keys(b).sort()
  return (
    keys.length === other.length &&
    keys.every((key, i) => key === other[i] && a[key]?.sha256 === b[key]?.sha256)
  )
}

const versionTaken = (facts: DeckFacts, existing: StoredVersion, files: FileMap) =>
  sameFiles(existing.files, files)
    ? accepted('already_published', facts, [])
    : refused(
        409,
        [
          {
            where: 'deck.version',
            message: `Version "${facts.version}" already exists with different content. Publish the change under a new version.`,
          },
        ],
        facts,
      )

const breakingMessage = (change: NotetypeChange) =>
  `${change.detail}. A published notetype keeps its structure (fields can only be added at the end): create a new notetype, with a new id, for this change.`

/**
 * Publishes one compiled edition sent by a deck's CI. The checks run in the order of the spec and
 * stop at the first refusal; the workspace is disposed of in every case. A re-run of the same CI
 * job (same version, same files) is `already_published`, even for a pending deck.
 */
export async function publishEdition<Archive>(
  deps: PublishDeps<Archive>,
  input: { token: string; edition: string; archive: Archive },
): Promise<PublishResult> {
  // 1. The token, then the per-deck rate limit.
  const deck = await findDeckByToken(deps.decks, input.token)
  if (!deck) return refused(401, [{ where: 'token', message: 'Invalid or revoked publish token.' }])
  const wait = deps.rateLimit(deck.id)
  if (wait !== null) {
    const result = refused(429, [
      { where: 'rate', message: `Too many publish requests for this deck. Retry in ${wait} s.` },
    ])
    return { ...result, retryAfter: wait }
  }
  // 2. A hidden deck takes nothing.
  if (deck.status === 'hidden')
    return refused(410, [{ where: 'deck', message: 'This deck has been removed from the hub.' }])
  // The token's last use: a request that got this far (not rate limited, deck not hidden).
  await recordTokenUse(deps.decks, deck)
  if (!isEditionCode(input.edition))
    return refused(422, [{ where: 'edition', message: 'Invalid edition in the URL.' }])

  const release = await deps.slot()
  if (!release) {
    const result = refused(503, [
      { where: 'server', message: 'The hub is busy with other publications. Retry shortly.' },
    ])
    return { ...result, retryAfter: deps.busyRetryAfter }
  }
  let workspace: EditionWorkspace | null = null
  try {
    workspace = deps.workspace(input.archive)
    // 3. Size of the upload.
    if ((await workspace.receive()) === 'too_large')
      return refused(413, [
        { where: 'archive', message: 'The archive is larger than the hub accepts.' },
      ])
    // 4. Safe extraction and layout.
    const unpacked = await workspace.unpack(input.edition)
    if (unpacked.length) return refused(422, unpacked)
    // 5. The official checker, non-strict as any consumer.
    const issues = await workspace.check()
    if (issues.length) return refused(422, issues)
    // 6. The deck of the token and the edition of the URL.
    const json = await workspace.deckJson()
    const facts = deckFacts(json)
    if (facts.id !== deck.deckId)
      return refused(
        409,
        [
          {
            where: 'deck.id',
            message: `deck.id "${facts.id}" does not match the deck of this token ("${deck.deckId}").`,
          },
        ],
        facts,
      )
    if (facts.edition !== input.edition)
      return refused(
        409,
        [
          {
            where: 'deck.edition',
            message: `deck.edition "${facts.edition}" does not match the edition of the URL ("${input.edition}").`,
          },
        ],
        facts,
      )
    // 7. "dev" identifies nothing.
    if (facts.version === 'dev')
      return refused(
        422,
        [
          {
            where: 'deck.version',
            message: 'Version "dev" cannot be published: build the deck in CI, which stamps it.',
          },
        ],
        facts,
      )
    const files = await workspace.files()
    const deckJsonSha256 = files['deck.json']?.sha256 ?? ''
    const summary: VersionSummary = {
      name: facts.name,
      description: facts.description,
      languages: facts.languages,
      license: facts.license,
      homepage: facts.homepage,
      notes: facts.notes,
      size: Object.values(files).reduce((total, file) => total + file.size, 0),
      search: searchText(facts.name, facts.description),
    }
    const preview = previewOf(json)
    // Steps 8 to 10 run twice at most: when another version of the edition was recorded since
    // step 9 read the latest one, they are judged again against that newer latest version.
    for (let attempt = 0; attempt < 2; attempt++) {
      // 8. A version already received.
      const edition = await deps.store.edition(deck.id, input.edition)
      const existing = edition && (await deps.store.version(edition.id, facts.version))
      if (existing) return versionTaken(facts, existing, files)
      // 9. Notetype structure against the latest version of the edition.
      const warnings: string[] = []
      if (edition?.latest) {
        const changes = await workspace.compat(edition.latest.deckJsonSha256)
        const breaking = changes.filter((change) => change.kind === 'breaking')
        if (breaking.length)
          return refused(
            409,
            breaking.map((change) => ({
              where: `notetypes: ${change.notetype}`,
              message: breakingMessage(change),
            })),
            facts,
          )
        for (const change of changes)
          warnings.push(
            `Notetype "${change.notetype}": ${change.detail}. Subscribers will need a full sync.`,
          )
      }
      // 10. Files first (by content, never rewritten), then the records in one transaction that
      // locks the edition and checks its latest version is still the one compared at step 9.
      await workspace.keep()
      const outcome = await deps.store.record({
        deck: deck.id,
        edition: input.edition,
        version: facts.version,
        summary,
        preview,
        files,
        deckJsonSha256,
        expectedLatest: edition?.latest?.id ?? null,
      })
      if (outcome === 'created')
        return accepted(deck.status === 'pending' ? 'pending_review' : 'published', facts, warnings)
      if (outcome === 'exists') {
        // A concurrent publish of the same version won: judged as a re-run.
        const winner = await deps.store.edition(deck.id, input.edition)
        const stored = winner && (await deps.store.version(winner.id, facts.version))
        if (!stored) throw new Error('Version reported as existing but not found')
        return versionTaken(facts, stored, files)
      }
      // 'stale': another version became the latest meanwhile; judged again once.
    }
    return refused(
      409,
      [
        {
          where: 'deck.version',
          message:
            'Other versions of this edition were published at the same time. Retry the publication.',
        },
      ],
      facts,
    )
  } finally {
    try {
      await workspace?.dispose()
    } finally {
      release()
    }
  }
}
