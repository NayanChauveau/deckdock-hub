import type { Payload } from 'payload'
import type { FileMap } from '../../application/publish'
import type { ServeStore } from '../../application/serve'
import type { IndexEntry } from '../../domain/serving'
import { isDeckStatus } from '../../domain/status'

const get = (doc: unknown, key: string): unknown => Reflect.get(Object(doc), key)
const idOf = (value: unknown): number | null => {
  const raw = typeof value === 'object' && value !== null ? get(value, 'id') : value
  return typeof raw === 'number' ? raw : null
}

function toFiles(value: unknown): FileMap {
  const files: Record<string, { sha256: string; size: number }> = {}
  if (typeof value !== 'object' || value === null) return files
  for (const [name, file] of Object.entries(value))
    files[name] = { sha256: String(get(file, 'sha256')), size: Number(get(file, 'size')) }
  return files
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/**
 * Reads for serving published decks, on Payload's Local API as the system (access overridden):
 * the routes are public, and only latest versions of editions ever leave this adapter.
 */
export function payloadServeStore(payload: Payload): ServeStore {
  const system = { overrideAccess: true, depth: 0 } as const

  const editionsOf = async (deck: number, code?: string) =>
    (
      await payload.find({
        collection: 'editions',
        where: code
          ? { and: [{ deck: { equals: deck } }, { code: { equals: code } }] }
          : { deck: { equals: deck } },
        pagination: false,
        select: { code: true, latestVersion: true },
        ...system,
      })
    ).docs

  return {
    async deck(handle, deckId) {
      const author = (
        await payload.find({
          collection: 'authors',
          where: { handle: { equals: handle } },
          limit: 1,
          pagination: false,
          select: { handle: true },
          ...system,
        })
      ).docs[0]
      if (!author) return null
      const deck = (
        await payload.find({
          collection: 'decks',
          where: { and: [{ author: { equals: author.id } }, { deckId: { equals: deckId } }] },
          limit: 1,
          pagination: false,
          select: { status: true },
          ...system,
        })
      ).docs[0]
      if (!deck) return null
      const status = get(deck, 'status')
      if (!isDeckStatus(status)) throw new Error(`Unknown deck status: ${String(status)}`)
      return { id: deck.id, status }
    },

    async latestVersions(deck) {
      const editions = await editionsOf(deck)
      const latest = new Map<number, string>()
      for (const edition of editions) {
        const id = idOf(get(edition, 'latestVersion'))
        if (id !== null) latest.set(id, String(get(edition, 'code')))
      }
      if (latest.size === 0) return []
      const versions = (
        await payload.find({
          collection: 'versions',
          where: { id: { in: [...latest.keys()] } },
          pagination: false,
          select: { version: true, summary: true },
          ...system,
        })
      ).docs
      return versions.map((version): IndexEntry => {
        const summary = get(version, 'summary')
        return {
          edition: latest.get(version.id) ?? '',
          name: text(get(summary, 'name')),
          language: strings(get(summary, 'languages')),
          version: String(get(version, 'version')),
        }
      })
    },

    async latestFiles(deck, code) {
      const edition = (await editionsOf(deck, code))[0]
      const id = edition ? idOf(get(edition, 'latestVersion')) : null
      if (id === null) return null
      const version = (
        await payload.find({
          collection: 'versions',
          where: { id: { equals: id } },
          limit: 1,
          pagination: false,
          select: { files: true },
          ...system,
        })
      ).docs[0]
      return version ? toFiles(get(version, 'files')) : null
    },
  }
}
