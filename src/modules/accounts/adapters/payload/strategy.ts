import type { AuthStrategy, Payload } from 'payload'
import type { Auth } from '../better-auth/auth'

/**
 * Payload's own rule before it accepts its session cookie (`extractJWT`, not exported by
 * payload 3.90), applied to Better Auth's cookie. An `Origin` must be in the `csrf` allowlist,
 * whatever `Sec-Fetch-Site` says. Without `Origin`, `Sec-Fetch-Site` must be same-origin,
 * same-site or none; a request with neither header (not a browser of the site) is refused while
 * an allowlist exists.
 */
export function cookieIsTrusted(headers: Headers, csrf: readonly string[]): boolean {
  const origin = headers.get('Origin')
  if (origin) return csrf.length === 0 || csrf.includes(origin)
  if (csrf.length === 0) return true
  const site = headers.get('Sec-Fetch-Site')
  return site === 'same-origin' || site === 'same-site' || site === 'none'
}

/** The same request without its cookies: what Better Auth sees from an untrusted origin. */
function withoutCookies(headers: Headers): Headers {
  const copy = new Headers(headers)
  copy.delete('cookie')
  return copy
}

/** The `customers` document, as this bridge reads it (no dependency on the site's generated types). */
export interface CustomerDocument {
  id: number
  authUserId: string
  email: string
  createdAt: string
  updatedAt: string
}

async function findCustomer(
  payload: Payload,
  authUserId: string,
): Promise<CustomerDocument | undefined> {
  const { docs } = await payload.find({
    collection: 'customers',
    where: { authUserId: { equals: authUserId } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  return docs[0]
}

/**
 * The visitor's `customers` document, created on their first authenticated request. Idempotent:
 * when two first requests race, the unique index on `authUserId` refuses the second insert (Payload
 * reports it as a validation error), and that request reads the winner's document instead.
 */
export async function ensureCustomer(
  authUser: { id: string; email: string },
  payload: Payload,
): Promise<CustomerDocument> {
  const existing = await findCustomer(payload, authUser.id)
  if (existing) return existing
  try {
    return await payload.create({
      collection: 'customers',
      data: { authUserId: authUser.id, email: authUser.email },
      overrideAccess: true,
    })
  } catch (error) {
    const winner = await findCustomer(payload, authUser.id)
    if (winner) return winner
    throw error
  }
}

const STRATEGY_NAME = 'better-auth'

/**
 * Whether a strategy Payload runs after this one authenticates the request. Payload runs the
 * strategies in collection order and pushes its own session (`local-jwt`) last, so a password
 * session of the administration (not yet through its second factor, or with it off) is only
 * recognised after the visitor's. Strategies before this one already answered no. Payload's
 * development auto-login is not a session: it is left out.
 */
async function laterStrategyAuthenticates(args: Parameters<AuthStrategy['authenticate']>[0]) {
  const strategies = args.payload.authStrategies
  const position = strategies.findIndex((entry) => entry.name === STRATEGY_NAME)
  if (position < 0) return false
  const headers = new Headers(args.headers)
  headers.set('DisableAutologin', 'true')
  for (const strategy of strategies.slice(position + 1)) {
    try {
      const { user } = await strategy.authenticate({
        ...args,
        headers,
        strategyName: strategy.name,
      })
      if (user) return true
    } catch {
      // Payload runs it again after this one and logs its error.
    }
  }
  return false
}

/**
 * Resolves `req.user` to the visitor's `customers` document from the Better Auth session. The
 * CSRF rule only concerns the cookie: other credentials Better Auth may accept are left as is.
 * Payload requests never extend the session: Payload drops the cookie Better Auth would send
 * back, so the database would outlive the browser cookie. Better Auth's own routes (sign-in,
 * `get-session` from the account pages) refresh both together.
 * A request that also carries another session (an administrator who is a visitor of their own
 * site too) is that session's: an administrator is never seen as a visitor.
 */
export const betterAuthStrategy = (getAuth: () => Auth): AuthStrategy => ({
  name: STRATEGY_NAME,
  authenticate: async (args) => {
    const { headers, payload } = args
    const trusted = cookieIsTrusted(headers, payload.config.csrf)
    const session = await getAuth().api.getSession({
      headers: trusted ? headers : withoutCookies(headers),
      query: { disableRefresh: true },
    })
    if (!session) return { user: null }
    if (await laterStrategyAuthenticates(args)) return { user: null }
    const customer = await ensureCustomer(session.user, payload)
    return { user: { ...customer, collection: 'customers', _strategy: STRATEGY_NAME } }
  },
})
