import type { Access, PayloadRequest } from 'payload'
import { totpAccess } from 'payload-totp'

/**
 * The user signed in to the administration collection. Payload sets `collection` on every
 * authenticated user at runtime (it is not typed on `req.user`). Another collection's user, whatever
 * fields it carries, is a visitor: it never reads `role`.
 */
export const isAdminCollectionUser = (user: unknown): boolean =>
  typeof user === 'object' && user !== null && 'collection' in user && user.collection === 'users'

const hasAdminRole = (user: unknown): boolean =>
  isAdminCollectionUser(user) && typeof user === 'object' && user !== null && 'role' in user
    ? user.role === 'admin'
    : false

/**
 * Fail closed: a Local API caller passing `user` with `overrideAccess: false` must set
 * `collection: 'users'` (Payload sets it itself on real sessions), or it is not an administrator.
 */
export const isAdmin = (req: PayloadRequest): boolean => hasAdminRole(req.user)
export const adminOnly: Access = ({ req }) => isAdmin(req)
export const publicRead: Access = () => true

/**
 * Strategy that authenticated the request. Payload sets `_strategy` on the user at runtime but
 * does not type it on `req.user`; payload-totp sets it to `totp` once the session entered a code.
 */
export function authStrategy(user: unknown): string | undefined {
  if (typeof user !== 'object' || user === null || !('_strategy' in user)) return undefined
  return typeof user._strategy === 'string' ? user._strategy : undefined
}

/** The account has a TOTP secret (virtual field set by payload-totp on the authenticated user). */
export const hasStoredSecret = (user: unknown): boolean =>
  typeof user === 'object' && user !== null && 'hasTotp' in user && user.hasTotp === true

/**
 * An administrator whose session passed the second factor, whatever the plugin settings: the TOTP
 * strategy, and a secret still on the account (an old TOTP cookie of a reset account is no proof).
 */
const isTotpVerifiedUser = (user: unknown): boolean =>
  hasAdminRole(user) && authStrategy(user) === 'totp' && hasStoredSecret(user)

export const isTotpVerifiedAdmin = (req: PayloadRequest): boolean => isTotpVerifiedUser(req.user)

/**
 * A session that sees the real site during maintenance: an administrator (of the users collection,
 * never another collection's user) whose session entered its TOTP code, or any administrator
 * when the second factor is off.
 */
export function canSeeThroughMaintenance(user: unknown, totpIsDisabled: boolean): boolean {
  // A password alone is not enough: only a session that entered its TOTP code sees the shop.
  return isTotpVerifiedUser(user) || (hasAdminRole(user) && totpIsDisabled)
}

const pluginDisabled = (req: PayloadRequest): boolean => {
  const custom: unknown = req.payload.config.custom
  if (typeof custom !== 'object' || custom === null || !('totp' in custom)) return false
  const totp: unknown = custom.totp
  if (typeof totp !== 'object' || totp === null || !('pluginOptions' in totp)) return false
  const options: unknown = totp.pluginOptions
  return typeof options === 'object' && options !== null && 'disabled' in options
    ? options.disabled === true
    : false
}

/**
 * Same rule as the collections wrapped by payload-totp (an administrator, a code entered in this
 * session), plus a secret still on the account. For what the plugin wrapper does not reach (jobs,
 * custom endpoints). Transparent when the plugin is disabled, which only the test suite and the
 * local administrator of `pnpm dev:setup` can do (see src/core/admin/totp.ts).
 */
const verifiedAdminAccess = totpAccess(adminOnly)
export async function isVerifiedAdmin(req: PayloadRequest): Promise<boolean> {
  if ((await verifiedAdminAccess({ req })) !== true) return false
  return pluginDisabled(req) || hasStoredSecret(req.user)
}
