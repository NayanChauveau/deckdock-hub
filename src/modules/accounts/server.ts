import { getPayload, type Payload } from 'payload'
import { logger } from '@/core/logger'
import { devOrigin, site } from '@/core/site'
import {
  closeAuthPool,
  createAuth,
  deleteAuthUser,
  existingAuthUsers,
  purgeExpiredAuthRecords,
  type Auth,
} from './adapters/better-auth/auth'
import { accountEmails } from './adapters/email/account-emails'
import { customersCreatedBefore, deleteCustomer } from './adapters/payload/Customers'
import {
  requestDeletionLink,
  sweepOrphanCustomers,
  visitorDeletion,
  type AccountRecords,
  type DeletionReport,
} from './application/delete-account'
import { requestSignInLink } from './application/sign-in-link'
import { deletedPath, signInPath } from './paths'

let instance: Auth | undefined

/** The site's Payload, imported on use: the Payload config imports this module, hence this file. */
async function sitePayload(): Promise<Payload> {
  const { default: config } = await import('@payload-config')
  return getPayload({ config })
}

/** Both halves of a visitor account: the Better Auth user and the `customers` document. */
export function accountRecords(payload: Payload): AccountRecords {
  return {
    removeAuthUser: (authUserId) => deleteAuthUser(getAuth(), authUserId),
    removeCustomer: (authUserId) => deleteCustomer(payload, authUserId),
    customersCreatedBefore: (cutoff, page) => customersCreatedBefore(payload, cutoff, page),
    existingAuthUsers: (authUserIds) => existingAuthUsers(getAuth(), authUserIds),
  }
}

/** An incomplete deletion, for the operator: the Better Auth id, never the address. */
export const reportDeletion: DeletionReport = ({ step, authUserId, error }) => {
  logger.error({ err: error, authUserId, step }, 'Suppression de compte incomplète')
}

/**
 * The scheduled orphan sweep (`accounts-orphan-sweep` task): expired Better Auth records first
 * (sign-in links that were never opened, old rate limit rows), then the orphan customers.
 */
export async function sweepOrphans(payload: Payload, now = new Date()) {
  await purgeExpiredAuthRecords(getAuth(), now)
  return sweepOrphanCustomers(accountRecords(payload), reportDeletion, now)
}

/**
 * The origin of Better Auth's links and its trusted origin: the site's public one, with the same
 * local fallback as Payload's `serverURL` outside production (where `APP_URL` is required).
 */
export function authBaseURL(env: {
  APP_URL?: string | undefined
  NODE_ENV?: string | undefined
}): string | undefined {
  return env.APP_URL || (env.NODE_ENV === 'production' ? undefined : devOrigin)
}

/** The one Better Auth instance of the process, created on first use, with the site's emails. */
export function getAuth(): Auth {
  if (instance) return instance
  const emails = accountEmails()
  const locales = { locales: site.identity.locales, defaultLocale: site.identity.defaultLocale }
  const deletion = async () => visitorDeletion(accountRecords(await sitePayload()), reportDeletion)
  return (instance = createAuth(
    {
      sendMagicLink: ({ email, url }) =>
        requestSignInLink({ email, url }, emails, { ...locales, signInPath }),
      sendDeletionLink: ({ user, url }) =>
        requestDeletionLink({ email: user.email, url }, emails, { ...locales, deletedPath }),
      beforeUserDeleted: async (user) => (await deletion()).beforeUserDeleted(user.id),
      afterUserDeleted: async (user) => (await deletion()).afterUserDeleted(user.id),
    },
    authBaseURL(process.env),
  ))
}

/**
 * The signed-in visitor of a page request. The session is read, never extended: a page cannot set
 * the cookie that goes with it (the account page extends it through Better Auth's own route).
 */
export async function visitorSession(headers: Headers): Promise<{ email: string } | null> {
  const session = await getAuth().api.getSession({ headers, query: { disableRefresh: true } })
  return session ? { email: session.user.email } : null
}

/** Forgets the instance and releases its pool (scripts and tests that must exit). */
export async function closeAuth(): Promise<void> {
  instance = undefined
  await closeAuthPool()
}
