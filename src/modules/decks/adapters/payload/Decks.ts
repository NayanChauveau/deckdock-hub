import {
  APIError,
  type CollectionBeforeChangeHook,
  type CollectionConfig,
  type PayloadRequest,
} from 'payload'
import { isVerifiedAdmin } from '@/core/payload/access'
import { reviewDeck } from '../../domain/review'
import { isDeckStatus, type DeckStatus } from '../../domain/status'
import { adminOrOwner, never } from './access'
import { reviewEndpoints } from './review-endpoints'
import { reviewMessages } from './review-messages'

const verifiedAdmin = ({ req }: { req: Parameters<typeof isVerifiedAdmin>[0] }) =>
  isVerifiedAdmin(req)

const text = (value: unknown): string | null => (typeof value === 'string' ? value : null)

/** Whether the deck's author lost its account (`authors.customer` set to null by the deletion). */
async function accountDeleted(req: PayloadRequest, author: unknown): Promise<boolean> {
  const id: unknown =
    typeof author === 'object' && author !== null ? Reflect.get(author, 'id') : author
  if (typeof id !== 'number') return true
  const doc = await req.payload.findByID({
    collection: 'authors',
    id,
    depth: 0,
    overrideAccess: true,
    disableErrors: true,
    req,
  })
  return (doc?.customer ?? null) === null
}

/**
 * Every change of status or reason follows the domain's review (src/modules/decks/domain/review.ts),
 * whoever writes it: the review endpoints, the admin's edit form, the use cases. Hiding needs a
 * reason; a deck of a deleted account is never approved again; an approval records its date.
 */
const reviewRules: CollectionBeforeChangeHook = async ({ data, originalDoc, operation, req }) => {
  if (operation !== 'update') return data
  if (data['status'] === undefined && data['hiddenReason'] === undefined) return data
  const original: unknown = Object(originalDoc)
  const from: unknown = Reflect.get(Object(original), 'status')
  const to: unknown = data['status'] ?? from
  const reason =
    data['hiddenReason'] === undefined
      ? text(Reflect.get(Object(original), 'hiddenReason'))
      : text(data['hiddenReason'])
  if (!isDeckStatus(from) || !isDeckStatus(to))
    throw new APIError(reviewMessages.transition_refused, 400)
  if (from === to) {
    // Editing the reason of a hidden deck: it may not be emptied.
    if (to === 'hidden' && !reason?.trim()) throw new APIError(reviewMessages.reason_required, 400)
    return data
  }
  const deleted =
    to === 'approved' && (await accountDeleted(req, Reflect.get(Object(original), 'author')))
  const decision = reviewDeck({ status: from, accountDeleted: deleted }, to, reason)
  if (!decision.ok) throw new APIError(reviewMessages[decision.error], 400)
  return {
    ...data,
    ...decision.value,
    ...(to === 'approved' ? { approvedAt: new Date().toISOString() } : {}),
  }
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
  endpoints: reviewEndpoints,
  hooks: { beforeChange: [reviewRules] },
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
      admin: { description: 'Obligatoire pour masquer un deck. Visible par son auteur.' },
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
