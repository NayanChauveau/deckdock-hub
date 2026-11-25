// Next.js reads `config.matcher` statically: it stays a literal here, the logic lives in the core.
export { proxy, LOCALE_HEADER, PATHNAME_HEADER } from './core/http/proxy'

export const config = {
  matcher: ['/fr', '/fr/:path*', '/en', '/en/:path*', '/admin', '/admin/:path*'],
}
