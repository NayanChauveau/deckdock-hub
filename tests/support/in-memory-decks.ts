import type { DecksStore } from '../../src/modules/decks/application/ports'
import { DecksError } from '../../src/modules/decks/domain/errors'
import type { Author, Deck } from '../../src/modules/decks/domain/model'

type StoredDeck = { -readonly [K in keyof Deck]: Deck[K] } & { tokenHash: string | null }

/** The decks store in memory, with the uniqueness rules of the Postgres one. */
export function inMemoryDecksStore() {
  const authors: Author[] = []
  const decks: StoredDeck[] = []
  const view = ({ tokenHash: _hash, ...deck }: StoredDeck): Deck => ({ ...deck })
  const byId = (id: number) => decks.find((deck) => deck.id === id)
  const store: DecksStore & { dump(): unknown } = {
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
    dump: () => ({ authors, decks }),
  }
  return store
}
