import { NextResponse, type NextRequest } from 'next/server'
import { site } from '../site'
import { activeAnalytics } from './analytics'
import { CSP_REPORT_PATH, contentSecurityPolicy, createNonce } from './csp'

/** Server-rendered pages without params (not-found) read the language from this request header. */
export const LOCALE_HEADER = 'x-site-locale'
/** payload-totp redirects to its setup or verify view from this header; never trusted from the client. */
export const PATHNAME_HEADER = 'x-pathname'

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers)
  const { pathname } = request.nextUrl
  headers.set(PATHNAME_HEADER, pathname)
  headers.set(LOCALE_HEADER, pathname.startsWith('/en') ? 'en' : 'fr')
  // Next.js takes the nonce from this request header and adds it to the page's scripts.
  const policy = contentSecurityPolicy({
    nonce: createNonce(),
    admin: pathname === '/admin' || pathname.startsWith('/admin/'),
    dev: process.env.NODE_ENV === 'development',
    analytics: activeAnalytics(site, process.env.NODE_ENV)?.host ?? null,
  })
  headers.set('Content-Security-Policy', policy)
  const response = NextResponse.next({ request: { headers } })
  response.headers.set('Content-Security-Policy', policy)
  response.headers.set('Reporting-Endpoints', `csp="${CSP_REPORT_PATH}"`)
  return response
}
