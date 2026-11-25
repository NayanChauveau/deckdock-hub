import { Forbidden, type PayloadHandler, type SanitizedConfig } from 'payload'
import { isAdminCollectionUser } from './access'

/** Signed in, but to another auth collection than the administration's. */
const otherCollectionSession = (user: unknown): boolean =>
  user !== null && user !== undefined && !isAdminCollectionUser(user)

const PAYLOAD_PREFIX = 'payload-'

/**
 * Every operation an access rule can exist for. A missing one is guarded too, with Payload's
 * default (any signed-in user) inside: payload-totp's `onInit` adds the missing ones later, and
 * its wrapper lets another collection's session through when there is no rule inside.
 */
const COLLECTION_OPERATIONS = ['create', 'delete', 'read', 'readVersions', 'unlock', 'update']
const GLOBAL_OPERATIONS = ['read', 'readVersions', 'update']
const payloadDefault = (args: { req: { user?: unknown } }): boolean => Boolean(args.req.user)

/**
 * Closes Payload's own collections and globals to sessions of other auth collections (visitor
 * accounts). Payload 3.90 adds them during sanitization, after every plugin, and several accept
 * any signed-in user: `payload-locked-documents` and `payload-folders` (`Boolean(req.user)` on
 * every operation), `payload-preferences` (rows of the caller, plus `/:key` endpoints that check
 * nothing but `req.user`), `payload-migrations` (Payload's default access, no endpoint) and the
 * `payload-jobs-stats` global (default access). `payload-jobs`, `payload-kv` and
 * `payload-query-presets` are already closed or owner-scoped; they get the same guard for free.
 *
 * Runs on the sanitized config, so it sees those collections, and on every config build, so
 * `next dev` reloads keep it. An administrator's session and anonymous requests keep each
 * collection's own rule, payload-totp's `onInit` wrapping included (it wraps this guard).
 */
export function restrictPayloadInternals(config: SanitizedConfig): SanitizedConfig {
  const internal = new Set<string>(
    config.collections
      .map((collection) => collection.slug)
      .filter((slug) => slug.startsWith(PAYLOAD_PREFIX)),
  )
  if (config.folders) internal.add(config.folders.slug)
  for (const collection of config.collections) {
    if (!internal.has(collection.slug)) continue
    guardAccess(collection.access, COLLECTION_OPERATIONS)
    if (Array.isArray(collection.endpoints))
      collection.endpoints = collection.endpoints.map((endpoint) => ({
        ...endpoint,
        handler: guardHandler(endpoint.handler),
      }))
  }
  for (const global of config.globals) {
    if (!global.slug.startsWith(PAYLOAD_PREFIX)) continue
    guardAccess(global.access, GLOBAL_OPERATIONS)
    if (Array.isArray(global.endpoints))
      global.endpoints = global.endpoints.map((endpoint) => ({
        ...endpoint,
        handler: guardHandler(endpoint.handler),
      }))
  }
  return config
}

/** Every access function of the entity answers `false` to another collection's session. */
function guardAccess(access: object, operations: readonly string[]): void {
  const current: Record<string, unknown> = { ...access }
  for (const operation of operations) current[operation] ??= payloadDefault
  const guarded: Record<string, unknown> = {}
  for (const [operation, inner] of Object.entries(current)) {
    if (typeof inner !== 'function') continue
    guarded[operation] = (args: { req: { user?: unknown } }): unknown => {
      if (otherCollectionSession(args.req.user)) return false
      const result: unknown = Reflect.apply(inner, undefined, [args])
      return result
    }
  }
  Object.assign(access, guarded)
}

/** Endpoints that skip collection access (preferences by key) refuse it as well. */
const guardHandler =
  (handler: PayloadHandler): PayloadHandler =>
  (req) => {
    if (otherCollectionSession(req.user)) throw new Forbidden(req.t)
    return handler(req)
  }
