import { ValidationError, type Payload, type Where } from 'payload'
import type { DecksStore } from '../../application/ports'
import { DecksError } from '../../domain/errors'
import type { DeckId, Handle } from '../../domain/handle'
import type { Author, Deck } from '../../domain/model'
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

/** The decks store on Payload's Local API. Every call is the system's: access is overridden. */
export function payloadDecksStore(payload: Payload): DecksStore {
  const system = { overrideAccess: true, depth: 0 } as const
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
  }
  return store
}
