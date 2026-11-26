import { headers } from 'next/headers'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { customerIdOf } from '../adapters/payload/access'

/** The site's Payload, for the author pages and their actions. */
export const sitePayload = (): Promise<Payload> => getPayload({ config })

/**
 * The signed-in visitor's `customers` id, from this request's Better Auth session (through the
 * accounts module's Payload strategy, which also creates the document on a first visit), or null.
 * An administrator's session is not a visitor's.
 */
export async function signedInCustomer(payload: Payload): Promise<number | null> {
  const { user } = await payload.auth({ headers: await headers() })
  return customerIdOf(user)
}
