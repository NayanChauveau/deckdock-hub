import { toNextJsHandler } from 'better-auth/next-js'
import { maintenanceResponse, maintenanceState } from '@/core/http/maintenance'
import { RequestError, boundedBody, privateHeaders } from '@/core/http/request-guards'
import { site } from '@/core/site'
import { callbackLocale } from '../../application/sign-in-link'
import { accountPath } from '../../paths'
import { failedDeletionLink } from './deletion-link'
import { getAuth } from '../../server'

/** Sign-in and session calls carry an address and a few return paths: 2 KiB is ample. */
const MAX_BODY = 2048

const privateResponse = (response: Response) => {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(privateHeaders)) headers.set(name, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/** The visitor's language, from the page a link returns to (`callbackURL`). */
const linkLocale = (request: Request) =>
  callbackLocale(new URL(request.url).searchParams.get('callbackURL'), {
    locales: site.identity.locales,
    defaultLocale: site.identity.defaultLocale,
  })

/**
 * During maintenance a visitor sees the maintenance page, as on the rest of the site. A link from
 * an email is a navigation: it goes to the visitor's account page, which shows maintenance, and
 * its token is left unused so it still works once the site reopens (within its 15 minutes).
 */
function maintenanceAnswer(request: Request): Response {
  if (request.method !== 'GET') return maintenanceResponse()
  return new Response(null, {
    status: 302,
    headers: { ...privateHeaders, Location: accountPath(linkLocale(request)) },
  })
}

/**
 * A sign-in request keeps only the address and the return paths. Better Auth would also take a
 * `name` and `metadata`, which anyone requesting a link for someone else's address could set.
 */
const signInKeys = ['email', 'callbackURL', 'newUserCallbackURL', 'errorCallbackURL']
function signInFields(body: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  let input: unknown
  try {
    input = JSON.parse(new TextDecoder().decode(body))
  } catch {
    return body // Better Auth answers the malformed request itself.
  }
  if (typeof input !== 'object' || input === null) return body
  const kept = Object.fromEntries(Object.entries(input).filter(([key]) => signInKeys.includes(key)))
  return new TextEncoder().encode(JSON.stringify(kept))
}

/**
 * A sign-in request is JSON, as the site's form sends it: `signInFields` filters only JSON. Better
 * Auth 1.7's router refuses other media types too (`allowedMediaTypes`); refused here as well, so
 * the filter never depends on that default.
 */
const isJSON = (request: Request) =>
  /^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')
const isSignIn = (request: Request) =>
  request.method === 'POST' && new URL(request.url).pathname.endsWith('/sign-in/magic-link')

/** The same request with its body read within the starter's limit. */
async function bounded(request: Request): Promise<Request> {
  if (request.method === 'GET' || request.method === 'HEAD' || !request.body) return request
  let body: Uint8Array<ArrayBuffer> = new Uint8Array(await boundedBody(request, MAX_BODY))
  if (isSignIn(request)) body = signInFields(body)
  const headers = new Headers(request.headers)
  headers.delete('content-length') // The body may have shrunk; the new length is computed.
  return new Request(request.url, { method: request.method, headers, body })
}

/**
 * Better Auth's own routes under /api/auth (sign-in by magic link, session, sign-out). Better Auth
 * checks the origin of its calls (`trustedOrigins`); answers are private: a magic link holds its
 * token in the address, and a session answer belongs to one visitor.
 */
async function handle(request: Request): Promise<Response> {
  // Before Better Auth runs: a magic link opened now must not be consumed. Administrators pass.
  if ((await maintenanceState(request.headers)).visitorBlocked) return maintenanceAnswer(request)
  if (isSignIn(request) && !isJSON(request))
    return Response.json(
      { error: 'unsupported_media_type' },
      { status: 415, headers: privateHeaders },
    )
  let forwarded: Request
  try {
    forwarded = await bounded(request)
  } catch (error) {
    if (!(error instanceof RequestError)) throw error
    return Response.json(
      { error: error.code },
      { status: error.code === 'too_large' ? 413 : 400, headers: privateHeaders },
    )
  }
  const handler = toNextJsHandler(getAuth())
  const response = await (request.method === 'GET' ? handler.GET : handler.POST)(forwarded)
  return (
    failedDeletionLink(request, response, accountPath(linkLocale(request))) ??
    privateResponse(response)
  )
}

export const GET = handle
export const POST = handle
