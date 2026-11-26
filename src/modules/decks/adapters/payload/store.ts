import { sql } from '@payloadcms/db-postgres'
import { ValidationError, type Payload, type PayloadRequest, type Where } from 'payload'
import type { DecksStore } from '../../application/ports'
import { DecksError } from '../../domain/errors'
import type { DeckId, Handle } from '../../domain/handle'
import type { Author, Deck, EditionHistory, PendingDeck } from '../../domain/model'
import { isDeckStatus } from '../../domain/status'

const get = (doc: unknown, key: string): unknown => Reflect.get(Object(doc), key)
/** A relationship read at depth 0 is an id; at depth > 0, a document. */
const idOf = (value: unknown): number | null => {
  const raw = typeof value === 'object' && value !== null ? get(value, 'id') : value
  return typeof raw === 'number' ? raw : null
}
const dateOf = (value: unknown): Date | null =>
  typeof value === 'string' && value ? new Date(value) : null

function toAuthor(doc: unknown): Author {
  return {
    id: Number(get(doc, 'id')),
    customerId: idOf(get(doc, 'customer')),
    handle: String(get(doc, 'handle')) as Handle,
  }
}

/** The token hash is never part of a `Deck`, even when Payload returns it (access overridden). */
function toDeck(doc: unknown): Deck {
  const status = get(doc, 'status')
  if (!isDeckStatus(status)) throw new Error(`Unknown deck status: ${String(status)}`)
  const hiddenReason = get(doc, 'hiddenReason')
  return {
    id: Number(get(doc, 'id')),
    authorId: Number(idOf(get(doc, 'author'))),
    deckId: String(get(doc, 'deckId')) as DeckId,
    status,
    approvedAt: dateOf(get(doc, 'approvedAt')),
    hiddenReason: typeof hiddenReason === 'string' && hiddenReason ? hiddenReason : null,
    tokenLastUsedAt: dateOf(get(doc, 'tokenLastUsedAt')),
  }
}

const numberOf = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/**
 * The decks store on Payload's Local API. Every call is the system's: access is overridden. With
 * `req`, every call joins that request's transaction (a hook on another collection's deletion).
 */
export function payloadDecksStore(payload: Payload, req?: Partial<PayloadRequest>): DecksStore {
  const system = { overrideAccess: true, depth: 0, ...(req ? { req } : {}) } as const
  const findOne = async (collection: 'authors' | 'decks', where: Where) =>
    (await payload.find({ collection, where, limit: 1, pagination: false, ...system })).docs[0] ??
    null

  const store: DecksStore = {
    async authorOfCustomer(customerId) {
      const doc = await findOne('authors', { customer: { equals: customerId } })
      return doc ? toAuthor(doc) : null
    },
    async createAuthor(customerId, handle) {
      try {
        return toAuthor(
          await payload.create({
            collection: 'authors',
            data: { customer: customerId, handle },
            ...system,
          }),
        )
      } catch (error) {
        if (!(error instanceof ValidationError)) throw error
        // A concurrent request won the unique index: tell which one.
        const existing = await store.authorOfCustomer(customerId)
        if (existing) {
          if (existing.handle === handle) return existing
          throw new DecksError('handle_already_chosen')
        }
        if (await findOne('authors', { handle: { equals: handle } }))
          throw new DecksError('handle_taken')
        throw error
      }
    },
    async deckOf(authorId, deckId) {
      const doc = await findOne('decks', {
        and: [{ author: { equals: authorId } }, { deckId: { equals: deckId } }],
      })
      return doc ? toDeck(doc) : null
    },
    async createDeck(authorId, deckId, tokenHash) {
      try {
        return toDeck(
          await payload.create({
            collection: 'decks',
            data: { author: authorId, deckId, status: 'pending', tokenHash },
            ...system,
          }),
        )
      } catch (error) {
        if (error instanceof ValidationError && (await store.deckOf(authorId, deckId)))
          throw new DecksError('deck_exists')
        throw error
      }
    },
    async setTokenHash(deck, tokenHash) {
      await payload.update({ collection: 'decks', id: deck, data: { tokenHash }, ...system })
    },
    async deckByTokenHash(tokenHash) {
      const doc = await findOne('decks', { tokenHash: { equals: tokenHash } })
      return doc ? toDeck(doc) : null
    },
    async touchToken(deck, at) {
      await payload.update({
        collection: 'decks',
        id: deck,
        data: { tokenLastUsedAt: at.toISOString() },
        ...system,
      })
    },
    async authorById(id) {
      const doc = await findOne('authors', { id: { equals: id } })
      return doc ? toAuthor(doc) : null
    },
    async deckById(id) {
      const doc = await findOne('decks', { id: { equals: id } })
      return doc ? toDeck(doc) : null
    },
    async decksOfAuthor(authorId) {
      const { docs } = await payload.find({
        collection: 'decks',
        where: { author: { equals: authorId } },
        sort: 'deckId',
        pagination: false,
        ...system,
      })
      return docs.map(toDeck)
    },
    async setReview(deck, review) {
      // The `decks` hook checks the review again and records the approval date.
      return toDeck(
        await payload.update({ collection: 'decks', id: deck, data: review, ...system }),
      )
    },
    async retireDecksOfAuthor(authorId, reason) {
      // One UPDATE, not Payload's bulk update (a write per document, whose failures are only
      // collected): the decks are all hidden and revoked, or none. Run in the caller's transaction
      // session when there is one (the customer's deletion), so it also rolls back with it.
      const transactionID = req?.transactionID === undefined ? undefined : await req.transactionID
      const session: unknown =
        transactionID === undefined
          ? undefined
          : Reflect.get(Object(payload.db.sessions), transactionID)
      const db =
        (Reflect.get(Object(session), 'db') as typeof payload.db.drizzle | undefined) ??
        payload.db.drizzle
      const result = await db.execute<{ id: unknown }>(
        sql`UPDATE decks SET status = 'hidden', hidden_reason = ${reason}, token_hash = NULL,
              updated_at = now()
            WHERE author_id = ${authorId} RETURNING id`,
      )
      return result.rows.length
    },
    async pendingDecks() {
      const { docs } = await payload.find({
        collection: 'decks',
        where: { status: { equals: 'pending' } },
        sort: 'createdAt',
        pagination: false,
        select: { deckId: true, author: true, createdAt: true },
        ...system,
      })
      const authorIds = [...new Set(docs.map((doc) => idOf(get(doc, 'author'))))].filter(
        (id): id is number => id !== null,
      )
      const authors = authorIds.length
        ? (
            await payload.find({
              collection: 'authors',
              where: { id: { in: authorIds } },
              pagination: false,
              select: { handle: true },
              ...system,
            })
          ).docs
        : []
      const handles = new Map(authors.map((author) => [author.id, author.handle]))
      return docs.flatMap((doc): PendingDeck[] => {
        const handle = handles.get(Number(idOf(get(doc, 'author'))))
        return handle
          ? [
              {
                id: doc.id,
                deckId: String(get(doc, 'deckId')) as DeckId,
                handle: handle as Handle,
                createdAt: new Date(String(get(doc, 'createdAt'))),
              },
            ]
          : []
      })
    },
    async editionsOf(deck) {
      const editions = (
        await payload.find({
          collection: 'editions',
          where: { deck: { equals: deck } },
          sort: 'code',
          pagination: false,
          select: { code: true },
          ...system,
        })
      ).docs
      if (!editions.length) return []
      const versions = (
        await payload.find({
          collection: 'versions',
          where: { edition: { in: editions.map((edition) => edition.id) } },
          sort: '-receivedAt',
          pagination: false,
          select: { edition: true, version: true, receivedAt: true, summary: true },
          ...system,
        })
      ).docs
      return editions.map((edition): EditionHistory => ({
        code: edition.code,
        versions: versions
          .filter((version) => idOf(get(version, 'edition')) === edition.id)
          .map((version) => ({
            version: String(get(version, 'version')),
            receivedAt: new Date(String(get(version, 'receivedAt'))),
            notes: numberOf(get(get(version, 'summary'), 'notes')),
          })),
      }))
    },
  }
  return store
}
