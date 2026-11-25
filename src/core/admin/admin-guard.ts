import { formatAdminURL } from 'payload/shared'
import { isAdminCollectionUser } from '@/core/payload/access'

/** Admin provider (import map path, relative to src) that runs before every other one. */
export const ADMIN_GUARD_PROVIDER = '/core/admin/components/AdminGuard#AdminGuard'

const trimSlash = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)

/**
 * Where to send the request, or null to let it through. Any signed-in user of a collection other
 * than `users` (a visitor account) leaves the administration for Payload's own unauthorized page.
 * It must happen before payload-totp, which would send such a user to its enrolment page.
 * The proxy cannot do this: knowing the session takes a database call, which middleware must not make.
 */
export function adminGuardRedirect(args: {
  user: unknown
  pathname: string
  adminRoute: string
}): string | null {
  const { user, pathname, adminRoute } = args
  if (!user || isAdminCollectionUser(user)) return null
  const unauthorized = `${trimSlash(adminRoute)}/unauthorized`
  return trimSlash(pathname) === unauthorized ? null : unauthorized
}

/** Replaces payload-totp's provider entry; same `serverProps`, see TotpGate. */
export const TOTP_GATE_PROVIDER = '/core/admin/components/TotpGate#TotpGate'
export const PAYLOAD_TOTP_PROVIDER = 'payload-totp/rsc#TOTPProvider'

/**
 * A signed-in user of a collection other than `users` never takes part in the second factor:
 * payload-totp would send it (no secret, forceSetup) to its enrolment page, which the guard sends
 * back to /admin/unauthorized, in a loop. Anyone else, including nobody, goes through payload-totp.
 */
export const bypassesTotp = (user: unknown): boolean => !!user && !isAdminCollectionUser(user)

/** Replaces Payload's unauthorized view (import map path, relative to src); see unauthorizedExit. */
export const UNAUTHORIZED_VIEW = '/core/admin/components/UnauthorizedView#UnauthorizedView'

/**
 * The one button of /admin/unauthorized. Payload's "Log out" ends a `users` session only: for a
 * signed-in user of another collection (a visitor account) it did nothing, so that user goes back
 * to the public site instead, where its own sign-out lives. Anyone else keeps Payload's logout.
 */
export function unauthorizedExit(
  user: unknown,
  routes: { adminRoute: string; logoutRoute: `/${string}` },
): { kind: 'logout' | 'site'; href: string } {
  if (user && !isAdminCollectionUser(user)) return { kind: 'site', href: '/' }
  // The same URL as Payload's own button.
  return {
    kind: 'logout',
    href: formatAdminURL({ adminRoute: routes.adminRoute, path: routes.logoutRoute }),
  }
}
