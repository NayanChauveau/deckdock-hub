import type { PayloadRequest } from 'payload'

/**
 * What another module contributes to `accounts` (`extensions.accounts` of its manifest): work to do
 * when a visitor account goes. `beforeCustomerDelete` runs before the `customers` document is
 * deleted, in the deletion's transaction, whatever deletes it (the visitor's own deletion, an
 * administrator, the orphan sweep). If it throws, the document stays, and the deletion is reported
 * and retried as any failed removal.
 */
export interface AccountsExtension {
  beforeCustomerDelete(args: { req: PayloadRequest; customerId: number }): Promise<void>
}

export const isAccountsExtension = (value: unknown): value is AccountsExtension =>
  typeof value === 'object' &&
  value !== null &&
  'beforeCustomerDelete' in value &&
  typeof value.beforeCustomerDelete === 'function'
