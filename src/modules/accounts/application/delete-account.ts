import { callbackLocale, type AccountEmails, type LocaleSettings } from './sign-in-link'

/**
 * Port: the two halves of a visitor account. Each removal is idempotent: what is already gone is
 * not an error, so an attempt interrupted halfway is finished by the next one.
 */
export interface AccountRecords {
  /** The Better Auth user, with its sessions, linked accounts and pending deletion links. */
  removeAuthUser(authUserId: string): Promise<void>
  /** The visitor's `customers` document, without asking Better Auth to delete the user again. */
  removeCustomer(authUserId: string): Promise<void>
  /**
   * One page of the `customers` documents created before `cutoff`, in id order: at most `limit`
   * of them, after the document `after` (from the first when `null`).
   */
  customersCreatedBefore(
    cutoff: Date,
    page: { after: number | null; limit: number },
  ): Promise<{ id: number; authUserId: string }[]>
  /** Which of these Better Auth users still exist. */
  existingAuthUsers(authUserIds: readonly string[]): Promise<Set<string>>
}

/** Port: one line for the operator. It names the Better Auth id, never the address. */
export type DeletionReport = (event: {
  step: 'before-user-deleted' | 'after-user-deleted' | 'orphan-sweep'
  authUserId: string
  error: unknown
}) => void

/** Removes the customer, or reports which account is left behind, then fails as before. */
async function removeCustomerOrReport(
  authUserId: string,
  step: Parameters<DeletionReport>[0]['step'],
  records: AccountRecords,
  report: DeletionReport,
) {
  try {
    await records.removeCustomer(authUserId)
  } catch (error) {
    report({ step, authUserId, error })
    throw error
  }
}

/**
 * The visitor's own deletion, around Better Auth's deletion of the user. The customer goes first:
 * if that fails, Better Auth deletes nothing and the visitor, still signed in, can ask for a new
 * link. Once the user is gone, the customer is removed again, in case a request that read the
 * session just before recreated it. What is still left after a failure there is an orphan, which
 * the sweep removes.
 */
export function visitorDeletion(records: AccountRecords, report: DeletionReport) {
  return {
    beforeUserDeleted: (authUserId: string) =>
      removeCustomerOrReport(authUserId, 'before-user-deleted', records, report),
    afterUserDeleted: (authUserId: string) =>
      removeCustomerOrReport(authUserId, 'after-user-deleted', records, report),
  }
}

/**
 * Deletes a whole visitor account from outside Better Auth's own flow: the customer, the Better
 * Auth user, then the customer again (recreated in between by a session that was still valid).
 * Safe to run again after a partial failure.
 */
export async function deleteAccount(authUserId: string, records: AccountRecords): Promise<void> {
  await records.removeCustomer(authUserId)
  await records.removeAuthUser(authUserId)
  await records.removeCustomer(authUserId)
}

/** A customer is only swept once this old: never one whose sign-in or deletion is under way. */
export const ORPHAN_MIN_AGE_MS = 10 * 60 * 1000
const BATCH = 500

/**
 * Removes the `customers` documents whose Better Auth user no longer exists: what a deletion
 * interrupted after the user went leaves behind. Documents younger than `ORPHAN_MIN_AGE_MS` are left
 * alone. Reads the candidates a page at a time (by id, so removals do not shift the pages), with
 * one lookup in Better Auth per page. Idempotent; one failure does not stop the others, and the run
 * fails at the end if any did.
 */
export async function sweepOrphanCustomers(
  records: AccountRecords,
  report: DeletionReport,
  now: Date,
  batch = BATCH,
): Promise<{ removed: number }> {
  const cutoff = new Date(now.getTime() - ORPHAN_MIN_AGE_MS)
  let removed = 0
  let failed = 0
  let after: number | null = null
  for (;;) {
    const page = await records.customersCreatedBefore(cutoff, { after, limit: batch })
    const existing = await records.existingAuthUsers(page.map((customer) => customer.authUserId))
    for (const { authUserId } of page.filter((customer) => !existing.has(customer.authUserId))) {
      try {
        await records.removeCustomer(authUserId)
        removed++
      } catch (error) {
        report({ step: 'orphan-sweep', authUserId, error })
        failed++
      }
    }
    const last = page.at(-1)
    if (!last || page.length < batch) break
    after = last.id
  }
  if (failed > 0) throw new Error(`${String(failed)} orphan customer(s) not removed.`)
  return { removed }
}

export interface DeletionLinkSettings extends LocaleSettings {
  /** The "account deleted" page of a language, where the confirmed link lands. */
  deletedPath(locale: string): string
}

/**
 * Sends the confirmation link Better Auth built for `email`. The language comes from the page of
 * the request (`callbackURL`); whatever that page was, the confirmed link lands on the site's own
 * "account deleted" page in that language.
 */
export async function requestDeletionLink(
  request: { email: string; url: string },
  emails: AccountEmails,
  settings: DeletionLinkSettings,
): Promise<void> {
  const link = new URL(request.url)
  const locale = callbackLocale(link.searchParams.get('callbackURL'), settings)
  link.searchParams.set('callbackURL', settings.deletedPath(locale))
  await emails.sendDeletionLink({ to: request.email, locale, url: link.toString() })
}
