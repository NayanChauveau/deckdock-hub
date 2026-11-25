import type { CollectionConfig } from 'payload'
import { adminOrOwner, never } from './access'

/**
 * A version received for an edition. Immutable: created by the publish use case (access
 * overridden), never updated nor deleted through the API.
 */
export const Versions: CollectionConfig = {
  slug: 'versions',
  labels: { singular: 'Version', plural: 'Versions' },
  admin: {
    group: 'Decks',
    useAsTitle: 'version',
    defaultColumns: ['version', 'edition', 'receivedAt'],
  },
  access: {
    read: adminOrOwner('edition.deck.author.customer'),
    create: never,
    update: never,
    delete: never,
  },
  indexes: [{ fields: ['edition', 'version'], unique: true }],
  fields: [
    {
      name: 'edition',
      label: 'Édition',
      type: 'relationship',
      relationTo: 'editions',
      required: true,
      index: true,
    },
    { name: 'version', label: 'Version', type: 'text', required: true },
    { name: 'receivedAt', label: 'Reçue le', type: 'date', required: true },
    {
      // name, description, languages, license, homepage, note count, size.
      name: 'summary',
      label: 'Résumé',
      type: 'json',
      required: true,
    },
    {
      // File name → { sha256, size }, for deck.json and every media file.
      name: 'files',
      label: 'Fichiers',
      type: 'json',
      required: true,
    },
    { name: 'deckJsonSha256', label: 'Empreinte de deck.json', type: 'text', required: true },
  ],
}
