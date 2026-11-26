import { headers } from 'next/headers'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { visitorHeaders } from '@/core/http/visitor-cookies'
import { customerIdOf } from '../adapters/payload/access'

/** The site's Payload, for the author pages and their actions. */
export const sitePayload = (): Promise<Payload> => getPayload({ config })

/**
 * The signed-in visitor's `customers` id, from this request's Better Auth session (through the
 * accounts module's Payload strategy, which also creates the document on a first visit), or null.
 * Read without the administration's cookies and API key (as the header and the sign-in page do):
 * an administrator who is also signed in as a visitor reaches their own author space. Only the
 * visitor account comes out of it; an administrator's session never grants anything here.
 */
export async function signedInCustomer(payload: Payload): Promise<number | null> {
  const { user } = await payload.auth({
    headers: visitorHeaders(await headers(), payload.config.cookiePrefix),
  })
  return customerIdOf(user)
}
