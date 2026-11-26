import type { PayloadRequest } from 'payload'

/** A page another module adds to the visitor's account ("Mon compte" links to it). */
export interface AccountLink {
  href: string
  label: string
}

/**
 * What another module contributes to `accounts` (`extensions.accounts` of its manifest).
 *
 * - `beforeCustomerDelete` runs before a `customers` document is deleted, with the deletion's
 *   request and transaction, whatever deletes it (the visitor's own deletion, an administrator,
 *   the orphan sweep). If it throws, that document is not deleted and the deletion fails, to be
 *   reported and retried as any failed removal. Payload's deletion by `where` keeps going with
 *   the other documents and commits what succeeded, so writes made before the throw may stay:
 *   a contribution does its work in one statement, and is safe to run again.
 * - `accountLinks` lists the module's pages for the visitor's account page, in its language.
 */
export interface AccountsExtension {
  beforeCustomerDelete?(args: { req: PayloadRequest; customerId: number }): Promise<void>
  accountLinks?(locale: string): readonly AccountLink[]
}

export const isAccountsExtension = (value: unknown): value is AccountsExtension => {
  if (typeof value !== 'object' || value === null) return false
  const remove: unknown = Reflect.get(value, 'beforeCustomerDelete')
  const links: unknown = Reflect.get(value, 'accountLinks')
  return (
    (remove === undefined || typeof remove === 'function') &&
    (links === undefined || typeof links === 'function') &&
    (remove !== undefined || links !== undefined)
  )
}
