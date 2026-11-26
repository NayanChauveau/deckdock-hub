import type { CollectionConfig } from 'payload'
import { adminOrOwner, never } from './access'

/** An edition of a deck (`deck.edition`) and its latest published version. System writes only. */
export const Editions: CollectionConfig = {
  slug: 'editions',
  labels: { singular: 'Édition', plural: 'Éditions' },
  admin: { group: 'Decks', useAsTitle: 'code', defaultColumns: ['code', 'deck', 'latestVersion'] },
  access: {
    read: adminOrOwner('deck.author.customer'),
    create: never,
    update: never,
    delete: never,
  },
  indexes: [{ fields: ['deck', 'code'], unique: true }],
  fields: [
    {
      name: 'deck',
      label: 'Deck',
      type: 'relationship',
      relationTo: 'decks',
      required: true,
      index: true,
    },
    { name: 'code', label: 'Édition', type: 'text', required: true },
    {
      name: 'latestVersion',
      label: 'Dernière version',
      type: 'relationship',
      relationTo: 'versions',
    },
  ],
}
