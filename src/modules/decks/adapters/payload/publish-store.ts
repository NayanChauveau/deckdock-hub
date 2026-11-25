import { ValidationError, type Payload, type PayloadRequest } from 'payload'
import type { FileMap, PublishStore, StoredVersion } from '../../application/publish'

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

const toVersion = (doc: unknown): StoredVersion => ({
  version: String(get(doc, 'version')),
  deckJsonSha256: String(get(doc, 'deckJsonSha256')),
  files: toFiles(get(doc, 'files')),
})

/**
 * Editions and versions on Payload's Local API, as the system (access overridden). A version is
 * recorded with its edition and the edition's latest version in one database transaction; the
 * unique indexes on (deck, code) and (edition, version) settle concurrent publishes.
 */
export function payloadPublishStore(payload: Payload): PublishStore {
  const system = { overrideAccess: true, depth: 0 } as const

  const findEdition = async (deck: number, code: string, req?: Partial<PayloadRequest>) =>
    (
      await payload.find({
        collection: 'editions',
        where: { and: [{ deck: { equals: deck } }, { code: { equals: code } }] },
        limit: 1,
        pagination: false,
        ...system,
        ...(req ? { req } : {}),
      })
    ).docs[0] ?? null
  const findVersion = async (edition: number, version: string) =>
    (
      await payload.find({
        collection: 'versions',
        where: { and: [{ edition: { equals: edition } }, { version: { equals: version } }] },
        limit: 1,
        pagination: false,
        ...system,
      })
    ).docs[0] ?? null

  const store: PublishStore = {
    async edition(deck, code) {
      const doc = await findEdition(deck, code)
      if (!doc) return null
      const latestId = idOf(get(doc, 'latestVersion'))
      const latest =
        latestId === null
          ? null
          : await payload.findByID({ collection: 'versions', id: latestId, ...system })
      return {
        id: Number(get(doc, 'id')),
        latest: latest
          ? {
              version: String(get(latest, 'version')),
              deckJsonSha256: String(get(latest, 'deckJsonSha256')),
            }
          : null,
      }
    },
    async version(edition, version) {
      const doc = await findVersion(edition, version)
      return doc ? toVersion(doc) : null
    },
    async record(input) {
      // Twice at most: a first publish of a new edition can lose the race on (deck, code) to a
      // concurrent publish of another version, and then finds the edition the second time.
      for (let attempt = 0; ; attempt++) {
        const transactionID = await payload.db.beginTransaction()
        const req: Partial<PayloadRequest> = transactionID === null ? {} : { transactionID }
        try {
          const edition =
            (await findEdition(input.deck, input.edition, req)) ??
            (await payload.create({
              collection: 'editions',
              data: { deck: input.deck, code: input.edition },
              req,
              ...system,
            }))
          const editionId = Number(get(edition, 'id'))
          const version = await payload.create({
            collection: 'versions',
            data: {
              edition: editionId,
              version: input.version,
              receivedAt: input.receivedAt.toISOString(),
              summary: { ...input.summary },
              files: { ...input.files },
              deckJsonSha256: input.deckJsonSha256,
            },
            req,
            ...system,
          })
          await payload.update({
            collection: 'editions',
            id: editionId,
            data: { latestVersion: Number(get(version, 'id')) },
            req,
            ...system,
          })
          if (transactionID !== null) await payload.db.commitTransaction(transactionID)
          return 'created'
        } catch (error) {
          if (transactionID !== null) await payload.db.rollbackTransaction(transactionID)
          if (!(error instanceof ValidationError)) throw error
          const edition = await findEdition(input.deck, input.edition)
          if (edition && (await findVersion(Number(get(edition, 'id')), input.version)))
            return 'exists'
          if (attempt >= 1) throw error
        }
      }
    },
  }
  return store
}
