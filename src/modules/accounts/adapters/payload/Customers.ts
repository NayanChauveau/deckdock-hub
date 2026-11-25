import {
  Forbidden,
  type Access,
  type CollectionAfterDeleteHook,
  type CollectionConfig,
  type Payload,
  type PayloadRequest,
} from 'payload'
import { deleteAuthUser, type Auth } from '../better-auth/auth'
import { betterAuthStrategy } from './strategy'

/**
 * Set in `req.context` by a deletion that already removed the Better Auth user (the visitor's own
 * deletion): the `afterDelete` hook then leaves Better Auth alone instead of deleting again.
 */
export const ACCOUNTS_DELETING = 'accountsDeleting'

/**
 * Removes the visitor's `customers` document, if any, flagged so that its hook does not go back to
 * Better Auth. Idempotent: a document already gone is not an error.
 */
export async function deleteCustomer(payload: Payload, authUserId: string): Promise<void> {
  const { errors } = await payload.delete({
    collection: 'customers',
    where: { authUserId: { equals: authUserId } },
    overrideAccess: true,
    context: { [ACCOUNTS_DELETING]: true },
  })
  const [first] = errors
  if (first) throw new Error(`Customer not deleted: ${first.message}`)
}

/**
 * One page of the `customers` documents created before `cutoff`, in id order, after the document
 * `after` (the orphan sweep): only their ids and Better Auth ids.
 */
export async function customersCreatedBefore(
  payload: Payload,
  cutoff: Date,
  { after, limit }: { after: number | null; limit: number },
): Promise<{ id: number; authUserId: string }[]> {
  const { docs } = await payload.find({
    collection: 'customers',
    where: {
      createdAt: { less_than: cutoff.toISOString() },
      ...(after === null ? {} : { id: { greater_than: after } }),
    },
    select: { authUserId: true },
    sort: 'id',
    limit,
    pagination: false,
    depth: 0,
    overrideAccess: true,
  })
  return docs.map((doc) => ({
    id: Number(Reflect.get(Object(doc), 'id')),
    authUserId: String(Reflect.get(Object(doc), 'authUserId')),
  }))
}

/**
 * A customer deleted from the administration takes its Better Auth user along (sessions and
 * accounts cascade inside `auth`), so the visitor's cookie no longer authenticates and nothing
 * recreates the document. Better Auth runs on its own pool, outside Payload's transaction: if it
 * fails, the hook throws and Payload rolls the deletion back; if Payload fails after it, the
 * document is an orphan that a new attempt, or the orphan sweep, removes.
 */
const deleteAuthUserAfter =
  (getAuth: () => Auth): CollectionAfterDeleteHook =>
  async ({ doc, req }) => {
    if (req.context[ACCOUNTS_DELETING] === true) return
    const authUserId: unknown = Reflect.get(Object(doc), 'authUserId')
    if (typeof authUserId === 'string' && authUserId) await deleteAuthUser(getAuth(), authUserId)
  }

const never = () => false

/**
 * Payload gives every auth collection `logout` and `refresh-token`. For visitors both would
 * touch the administration's `payload-token` cookie (expire it, or mint one Payload then refuses);
 * the visitor signs out through Better Auth. Listed before Payload's own, so they win.
 */
const refusedAuthEndpoints = (['/logout', '/refresh-token'] as const).map((path) => ({
  path,
  method: 'post' as const,
  handler: (req: PayloadRequest): never => {
    throw new Forbidden(req.t)
  },
}))

/** The signed-in visitor's own document, whatever other fields the user object carries. */
const ownDocument: Access = ({ req }) => {
  const user: unknown = req.user
  if (typeof user !== 'object' || user === null) return false
  if (!('collection' in user) || user.collection !== 'customers' || !('id' in user)) return false
  return typeof user.id === 'number' ? { id: { equals: user.id } } : false
}

/**
 * The Payload side of a visitor account. Better Auth owns the identity (`auth` schema); this
 * document is created by the strategy on the first authenticated request and never written
 * through the API. Administrators list, view and delete it, nothing else. The site tells who is
 * an administrator (`isAdmin`) and the module gives its Better Auth instance (`getAuth`), so the
 * bridge does not depend on the rest of the starter.
 */
export const customersCollection = (options: {
  isAdmin: (req: PayloadRequest) => boolean
  getAuth: () => Auth
}): CollectionConfig => ({
  slug: 'customers',
  labels: { singular: 'Client', plural: 'Clients' },
  auth: { disableLocalStrategy: true, strategies: [betterAuthStrategy(options.getAuth)] },
  endpoints: refusedAuthEndpoints,
  hooks: { afterDelete: [deleteAuthUserAfter(options.getAuth)] },
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'createdAt'],
    description: 'Comptes visiteurs, créés à leur première connexion. Lecture et suppression.',
  },
  access: {
    // A visitor's session never opens the administration.
    admin: never,
    read: (args) => options.isAdmin(args.req) || ownDocument(args),
    create: never,
    update: never,
    delete: ({ req }) => options.isAdmin(req),
  },
  fields: [
    {
      name: 'authUserId',
      label: 'Identifiant Better Auth',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      access: { update: never },
    },
    {
      // Text, not Payload's `email` type: Better Auth already validated the address, and Payload's
      // stricter check would refuse some it accepted, failing every request of that visitor.
      name: 'email',
      label: 'Adresse e-mail',
      type: 'text',
      required: true,
      access: { update: never },
    },
  ],
})
