import type { CollectionConfig } from 'payload'
import { adminOrOwner, never } from './access'

/**
 * A customer's public handle. Written only by the module's use cases (Local API, access
 * overridden). The document outlives its customer (`customer` becomes null on account deletion),
 * so a handle is never given to someone else.
 */
export const Authors: CollectionConfig = {
  slug: 'authors',
  labels: { singular: 'Auteur', plural: 'Auteurs' },
  admin: {
    group: 'Decks',
    useAsTitle: 'handle',
    defaultColumns: ['handle', 'customer', 'createdAt'],
    description:
      'Pseudos publics des auteurs. Un pseudo reste réservé après la suppression du compte.',
  },
  access: {
    read: adminOrOwner('customer'),
    create: never,
    update: never,
    delete: never,
  },
  fields: [
    {
      name: 'customer',
      label: 'Compte',
      type: 'relationship',
      relationTo: 'customers',
      unique: true,
      index: true,
    },
    {
      name: 'handle',
      label: 'Pseudo',
      type: 'text',
      required: true,
      unique: true,
      index: true,
    },
  ],
}
