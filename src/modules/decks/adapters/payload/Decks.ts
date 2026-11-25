import { APIError, type CollectionBeforeChangeHook, type CollectionConfig } from 'payload'
import { isVerifiedAdmin } from '@/core/payload/access'
import { canTransition, isDeckStatus, type DeckStatus } from '../../domain/status'
import { adminOrOwner, never } from './access'

const verifiedAdmin = ({ req }: { req: Parameters<typeof isVerifiedAdmin>[0] }) =>
  isVerifiedAdmin(req)

/** A status change follows the domain's transitions; an approval records its date. */
const statusTransition: CollectionBeforeChangeHook = ({ data, originalDoc, operation }) => {
  if (operation !== 'update' || data['status'] === undefined) return data
  const from: unknown = Reflect.get(Object(originalDoc), 'status')
  const to: unknown = data['status']
  if (from === to) return data
  if (!isDeckStatus(from) || !isDeckStatus(to) || !canTransition(from, to))
    throw new APIError(`Changement de statut refusé : ${String(from)} → ${String(to)}`, 400)
  return to === 'approved' ? { ...data, approvedAt: new Date().toISOString() } : data
}

/**
 * A deck of an author. Created and given tokens by the use cases only; a visitor reads their own
 * decks and never the token hash; only a verified administrator changes the status (review).
 */
export const Decks: CollectionConfig = {
  slug: 'decks',
  labels: { singular: 'Deck', plural: 'Decks' },
  admin: {
    group: 'Decks',
    useAsTitle: 'deckId',
    defaultColumns: ['deckId', 'author', 'status', 'createdAt'],
  },
  access: {
    read: adminOrOwner('author.customer'),
    create: never,
    update: verifiedAdmin,
    delete: never,
  },
  hooks: { beforeChange: [statusTransition] },
  indexes: [{ fields: ['author', 'deckId'], unique: true }],
  fields: [
    {
      name: 'author',
      label: 'Auteur',
      type: 'relationship',
      relationTo: 'authors',
      required: true,
      index: true,
      access: { update: never },
    },
    {
      name: 'deckId',
      label: 'Identifiant du deck',
      type: 'text',
      required: true,
      access: { update: never },
    },
    {
      name: 'status',
      label: 'Statut',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: [
        { label: 'En attente', value: 'pending' },
        { label: 'Publié', value: 'approved' },
        { label: 'Masqué', value: 'hidden' },
      ] satisfies { label: string; value: DeckStatus }[],
      index: true,
      access: { update: verifiedAdmin },
    },
    {
      name: 'approvedAt',
      label: 'Validé le',
      type: 'date',
      admin: { readOnly: true },
      access: { update: never },
    },
    {
      name: 'hiddenReason',
      label: 'Raison du masquage',
      type: 'textarea',
      access: { update: verifiedAdmin },
    },
    {
      // sha256 of the publish token. Never readable through the API, even by administrators; the
      // use cases query it with access overridden.
      name: 'tokenHash',
      type: 'text',
      unique: true,
      index: true,
      admin: { hidden: true },
      access: { read: never, create: never, update: never },
    },
    {
      name: 'tokenLastUsedAt',
      label: 'Jeton utilisé le',
      type: 'date',
      admin: { readOnly: true },
      access: { update: never },
    },
  ],
}
