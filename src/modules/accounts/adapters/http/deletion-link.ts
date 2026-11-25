import { privateHeaders } from '@/core/http/request-guards'
import { deletionLinkError, tooManyError } from '../../paths'

/**
 * A deletion link that deletes nothing (opened without the visitor's session, used or expired):
 * Better Auth answers it with raw JSON. The visitor gets their account page instead, which explains
 * why (or the sign-in page when they are not signed in in this browser); a link refused by the rate
 * limit says so instead. Better Auth's cookies (a cleared or refreshed session) are kept.
 * `undefined` for any other answer.
 */
export function failedDeletionLink(
  request: Request,
  response: Response,
  accountURL: string,
): Response | undefined {
  if (
    request.method !== 'GET' ||
    !new URL(request.url).pathname.endsWith('/delete-user/callback') ||
    response.status < 400 ||
    response.status >= 500
  )
    return undefined
  const error = response.status === 429 ? tooManyError : deletionLinkError
  const headers = new Headers(privateHeaders)
  headers.set('Location', `${accountURL}?error=${error}`)
  for (const cookie of response.headers.getSetCookie()) headers.append('Set-Cookie', cookie)
  return new Response(null, { status: 302, headers })
}
