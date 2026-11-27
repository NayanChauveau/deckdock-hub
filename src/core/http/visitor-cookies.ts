/**
 * The request's cookies without the administration's (`<prefix>-token`, `<prefix>-totp`…, Payload's
 * `cookiePrefix`). The visitor accounts' Payload strategy steps aside for an administrator's
 * session, so that the administration never sees a visitor; the site's header and the visitor
 * pages read the same browser's visitor session from these cookies instead, as the sign-in page's
 * own session check does. Nothing of the administrator's is kept, so it never grants anything.
 */
export function visitorCookies(cookie: string, prefix: string): string {
  return cookie
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !part.startsWith(`${prefix}-`))
    .join('; ')
}

/**
 * A copy of the request's headers for reading its visitor session: the administration's cookies
 * and any `Authorization` (an administrator's API key) are left out, everything else (`Origin`,
 * `Sec-Fetch-Site`, for the CSRF rule) is kept.
 */
export function visitorHeaders(headers: Headers, prefix: string): Headers {
  const copy = new Headers(headers)
  copy.delete('authorization')
  const cookie = visitorCookies(headers.get('cookie') ?? '', prefix)
  if (cookie) copy.set('cookie', cookie)
  else copy.delete('cookie')
  return copy
}
