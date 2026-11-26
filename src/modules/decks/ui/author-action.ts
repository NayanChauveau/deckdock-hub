import { DecksError } from '../domain/errors'
import type { Failed } from './results'

/** What an author action needs from the request: maintenance, Payload, the visitor, the log. */
export interface AuthorActionEnv<P> {
  /** The site's maintenance keeps visitors out (as for every visitor page and mutation). */
  visitorBlocked(): Promise<boolean>
  payload(): Promise<P>
  /** The signed-in visitor's `customers` id, or null. */
  customer(payload: P): Promise<number | null>
  /** An unexpected failure, for the operator: never the input or a token. */
  report(error: unknown, action: string): void
}

/**
 * Runs one author action for the signed-in visitor. Refused during maintenance and without a
 * session; a module rule's refusal comes back as its code, anything else as `unexpected`.
 */
export async function runAuthorAction<P, T extends { ok: true }>(
  env: AuthorActionEnv<P>,
  name: string,
  action: (payload: P, customerId: number) => Promise<T>,
): Promise<T | Failed> {
  try {
    if (await env.visitorBlocked()) return { ok: false, error: 'maintenance' }
    const payload = await env.payload()
    const customerId = await env.customer(payload)
    if (customerId === null) return { ok: false, error: 'signed_out' }
    return await action(payload, customerId)
  } catch (error) {
    if (error instanceof DecksError) return { ok: false, error: error.code }
    env.report(error, name)
    return { ok: false, error: 'unexpected' }
  }
}
