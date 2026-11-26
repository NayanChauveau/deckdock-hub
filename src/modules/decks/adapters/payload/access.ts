import type { Access, PayloadRequest, Where } from 'payload'
import { isAdmin } from '@/core/payload/access'

export const never = () => false

/** The signed-in visitor's `customers` id, or null (an administrator, or nobody). */
export const visitorId = (req: PayloadRequest): number | null => customerIdOf(req.user)

/** The `customers` id of an authenticated user, or null for any other user (or none). */
export function customerIdOf(user: unknown): number | null {
  if (typeof user !== 'object' || user === null) return null
  if (!('collection' in user) || user.collection !== 'customers' || !('id' in user)) return null
  return typeof user.id === 'number' ? user.id : null
}

/**
 * Administrators read everything; a visitor reads only the documents whose `path` leads to their
 * own `customers` document (for example `author.customer` on a deck); anybody else reads nothing.
 */
export const adminOrOwner =
  (path: string): Access =>
  ({ req }) => {
    if (isAdmin(req)) return true
    const id = visitorId(req)
    return id === null ? false : ({ [path]: { equals: id } } satisfies Where)
  }
