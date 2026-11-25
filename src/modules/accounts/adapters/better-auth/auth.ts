import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import { magicLink } from 'better-auth/plugins/magic-link'
import { PostgresDialect } from 'kysely'
import pg from 'pg'
import { resolveAuthSecret } from './secret'

/** Better Auth keeps its tables in their own Postgres schema, away from Payload's. */
export const AUTH_SCHEMA = 'auth'

/** A magic link is single-use and valid for 15 minutes. */
export const MAGIC_LINK_TTL_SECONDS = 900

/** What the magic link plugin hands over: the address and the link Better Auth built for it. */
export type SendMagicLink = (data: { email: string; url: string; token: string }) => Promise<void>

/**
 * The sender of the options alone (migration diff, scripts): it refuses to send and never writes
 * the link anywhere (a link is a login). The module composes the real one (`server.ts`).
 */
export function sendMagicLinkPlaceholder(_data: {
  email: string
  url: string
  token: string
}): never {
  throw new Error('Magic link sending is not configured.')
}

/** What `user.deleteUser` hands over: the signed-in user and the confirmation link built for them. */
export type SendDeletionLink = (data: {
  user: { id: string; email: string }
  url: string
  token: string
}) => Promise<void>

/** What the module plugs into Better Auth: its emails, and the rest of a deleted account. */
export interface AuthSenders {
  sendMagicLink: SendMagicLink
  /** The email that confirms an account deletion; the link is valid 24 hours (Better Auth's default). */
  sendDeletionLink: SendDeletionLink
  /** Runs before Better Auth deletes the user: a failure here leaves the account untouched. */
  beforeUserDeleted: (user: { id: string }) => Promise<void>
  /** Runs once Better Auth deleted the user, its sessions and accounts. */
  afterUserDeleted: (user: { id: string }) => Promise<void>
}

const notConfigured = (): never => {
  throw new Error('Account deletion is not configured.')
}

/** The senders of the options alone (migration diff, scripts): none of them sends anything. */
export const placeholderSenders: AuthSenders = {
  sendMagicLink: sendMagicLinkPlaceholder,
  sendDeletionLink: notConfigured,
  beforeUserDeleted: notConfigured,
  afterUserDeleted: notConfigured,
}

let pool: pg.Pool | undefined

// The module's own small pool on the site database; Payload keeps its own.
function getPool(): pg.Pool {
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) throw new Error('DATABASE_URL est requis.')
  return (pool ??= new pg.Pool({ connectionString, max: 5 }))
}

/**
 * Better Auth's own limiter runs in production only (as its default). Without a client IP, which
 * is the case in development and in the test suite, every request would share one bucket per path.
 */
export function authRateLimit(env: { NODE_ENV?: string | undefined }) {
  return { enabled: env.NODE_ENV === 'production', storage: 'database' } as const
}

/**
 * The Better Auth options: also what `getMigrations()` diffs the database against. The module
 * gives the senders and the site's public origin (`baseURL`, also the one trusted origin), so this
 * bridge depends neither on the site's email settings nor on Payload. Without it, Better Auth would
 * build its links from each request's `Host`.
 */
export function getAuthOptions(
  senders: AuthSenders = placeholderSenders,
  baseURL: string | undefined = process.env['APP_URL'] || undefined,
) {
  const secret = resolveAuthSecret(process.env)
  return {
    ...(baseURL ? { baseURL, trustedOrigins: [baseURL] } : {}),
    ...(secret ? { secret } : {}),
    basePath: '/api/auth',
    database: {
      dialect: new PostgresDialect({ pool: getPool() }),
      type: 'postgres',
      schemaName: AUTH_SCHEMA,
      transaction: true,
    },
    rateLimit: authRateLimit(process.env),
    advanced: {
      cookiePrefix: 'customer',
      // Behind Traefik, the same header the starter's own request identity reads.
      ipAddress: { ipAddressHeaders: ['x-real-ip'] },
    },
    user: {
      deleteUser: {
        enabled: true,
        // With a sender, `/delete-user` only ever emails a link: a session alone deletes nothing.
        sendDeleteAccountVerification: ({ user, url, token }) =>
          senders.sendDeletionLink({ user: { id: user.id, email: user.email }, url, token }),
        beforeDelete: (user) => senders.beforeUserDeleted({ id: user.id }),
        afterDelete: (user) => senders.afterUserDeleted({ id: user.id }),
      },
    },
    plugins: [
      magicLink({
        expiresIn: MAGIC_LINK_TTL_SECONDS,
        sendMagicLink: senders.sendMagicLink,
        // Only a SHA-256 of the token is stored: reading the database gives no usable sign-in link.
        storeToken: 'hashed',
      }),
    ],
  } satisfies BetterAuthOptions
}

/** A Better Auth instance on the module's pool; the module keeps the one of the process. */
export function createAuth(senders: AuthSenders, baseURL: string | undefined) {
  return betterAuth(getAuthOptions(senders, baseURL))
}

export type Auth = ReturnType<typeof createAuth>

/**
 * Deletes a Better Auth user, without its `deleteUser` hooks (they are what calls the rest of the
 * deletion). One statement: its sessions and accounts follow by the `auth` schema's own cascade, so
 * a failure leaves the account whole. Then its pending deletion links. Nothing to do when the user
 * is already gone. A pending sign-in link holds the address, not the user, and expires in 15 minutes.
 */
export async function deleteAuthUser(auth: Auth, userId: string): Promise<void> {
  const { adapter } = await auth.$context
  await adapter.deleteMany({ model: 'user', where: [{ field: 'id', value: userId }] })
  await adapter.deleteMany({
    model: 'verification',
    where: [
      { field: 'value', value: userId },
      { field: 'identifier', operator: 'starts_with', value: 'delete-account-' },
    ],
  })
}

/** Rate limit rows older than this are read by no window (Better Auth's are seconds long). */
export const RATE_LIMIT_RETENTION_MS = 60 * 60 * 1000

/**
 * Removes the expired verification rows (an unclicked sign-in link holds the address it was sent
 * to; Better Auth only cleans them up on a later lookup) and the rate limit rows no window still
 * reads. Run by the hourly orphan sweep.
 */
export async function purgeExpiredAuthRecords(auth: Auth, now: Date): Promise<void> {
  const { adapter } = await auth.$context
  await adapter.deleteMany({
    model: 'verification',
    where: [{ field: 'expiresAt', operator: 'lt', value: now }],
  })
  await adapter.deleteMany({
    model: 'rateLimit',
    where: [
      { field: 'lastRequest', operator: 'lt', value: now.getTime() - RATE_LIMIT_RETENTION_MS },
    ],
  })
}

/** Which of these Better Auth users still exist. */
export async function existingAuthUsers(
  auth: Auth,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set()
  const context = await auth.$context
  const users = await context.adapter.findMany<{ id: string }>({
    model: 'user',
    where: [{ field: 'id', operator: 'in', value: [...userIds] }],
    limit: userIds.length,
  })
  return new Set(users.map((user) => user.id))
}

/** Releases the pool (scripts and tests that must exit). */
export async function closeAuthPool(): Promise<void> {
  const open = pool
  pool = undefined
  await open?.end()
}
