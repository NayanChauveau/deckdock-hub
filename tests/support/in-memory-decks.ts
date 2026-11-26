import type { DecksStore } from '../../src/modules/decks/application/ports'
import { DecksError } from '../../src/modules/decks/domain/errors'
import type {
  Author,
  Deck,
  EditionHistory,
  ReceivedVersion,
} from '../../src/modules/decks/domain/model'

type StoredDeck = { -readonly [K in keyof Deck]: Deck[K] } & {
  tokenHash: string | null
  createdAt: Date
}

/** The decks store in memory, with the uniqueness rules of the Postgres one. */
export function inMemoryDecksStore() {
  let authors: Author[] = []
  const decks: StoredDeck[] = []
  const editions = new Map<number, Map<string, ReceivedVersion[]>>()
  const view = ({ tokenHash: _hash, createdAt: _at, ...deck }: StoredDeck): Deck => ({ ...deck })
  const byId = (id: number) => decks.find((deck) => deck.id === id)
  const store: DecksStore & {
    dump(): unknown
    tokenHashOf(deck: number): string | null | undefined
    /** What deleting the customer does in Postgres: `authors.customer` becomes null. */
    detachCustomer(customerId: number): void
    addVersion(deck: number, code: string, version: ReceivedVersion): void
  } = {
    authorOfCustomer: async (customerId) =>
      authors.find((author) => author.customerId === customerId) ?? null,
    createAuthor: async (customerId, handle) => {
      if (authors.some((author) => author.handle === handle)) throw new DecksError('handle_taken')
      if (authors.some((author) => author.customerId === customerId))
        throw new DecksError('handle_already_chosen')
      const author = { id: authors.length + 1, customerId, handle }
      authors.push(author)
      return author
    },
    deckOf: async (authorId, deckId) => {
      const deck = decks.find((d) => d.authorId === authorId && d.deckId === deckId)
      return deck ? view(deck) : null
    },
    createDeck: async (authorId, deckId, tokenHash) => {
      if (decks.some((d) => d.authorId === authorId && d.deckId === deckId))
        throw new DecksError('deck_exists')
      const deck: StoredDeck = {
        id: decks.length + 1,
        authorId,
        deckId,
        status: 'pending',
        approvedAt: null,
        hiddenReason: null,
        tokenLastUsedAt: null,
        tokenHash,
        createdAt: new Date(Date.UTC(2026, 10, 26, 0, 0, decks.length)),
      }
      decks.push(deck)
      return view(deck)
    },
    setTokenHash: async (id, tokenHash) => {
      const deck = byId(id)
      if (deck) deck.tokenHash = tokenHash
    },
    deckByTokenHash: async (tokenHash) => {
      const deck = decks.find((d) => d.tokenHash === tokenHash)
      return deck ? view(deck) : null
    },
    touchToken: async (id, at) => {
      const deck = byId(id)
      if (deck) deck.tokenLastUsedAt = at
    },
    authorById: async (id) => authors.find((author) => author.id === id) ?? null,
    deckById: async (id) => {
      const deck = byId(id)
      return deck ? view(deck) : null
    },
    decksOfAuthor: async (authorId) =>
      decks
        .filter((deck) => deck.authorId === authorId)
        .sort((a, b) => a.deckId.localeCompare(b.deckId))
        .map(view),
    setReview: async (id, review) => {
      const deck = byId(id)
      if (!deck) throw new Error('no such deck')
      deck.status = review.status
      deck.hiddenReason = review.hiddenReason
      if (review.status === 'approved') deck.approvedAt = new Date()
      return view(deck)
    },
    retire: async (id, reason) => {
      const deck = byId(id)
      if (!deck) return
      deck.status = 'hidden'
      deck.hiddenReason = reason
      deck.tokenHash = null
    },
    pendingDecks: async () =>
      decks
        .filter((deck) => deck.status === 'pending')
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .flatMap((deck) => {
          const author = authors.find((a) => a.id === deck.authorId)
          return author
            ? [
                {
                  id: deck.id,
                  deckId: deck.deckId,
                  handle: author.handle,
                  createdAt: deck.createdAt,
                },
              ]
            : []
        }),
    editionsOf: async (deck) =>
      [...(editions.get(deck) ?? new Map<string, ReceivedVersion[]>())]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, versions]): EditionHistory => ({
          code,
          versions: [...versions].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()),
        })),
    tokenHashOf: (id) => byId(id)?.tokenHash,
    detachCustomer: (customerId) => {
      authors = authors.map((author) =>
        author.customerId === customerId ? { ...author, customerId: null } : author,
      )
    },
    addVersion: (deck, code, version) => {
      const byCode = editions.get(deck) ?? new Map<string, ReceivedVersion[]>()
      byCode.set(code, [...(byCode.get(code) ?? []), version])
      editions.set(deck, byCode)
    },
    dump: () => ({ authors, decks }),
  }
  return store
}
