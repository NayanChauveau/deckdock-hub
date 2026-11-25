import { withPayload } from '@payloadcms/next/withPayload'

const noindex = { key: 'X-Robots-Tag', value: 'noindex, nofollow' }
const security = [
  // HTTPS is enforced by Traefik in production; browsers ignore HSTS on plain-HTTP localhost.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  },
  // Baseline for every response. The HTML pages (site and administration) also get the full policy,
  // with a nonce per request, from src/proxy.ts (src/core/http/csp.ts); browsers enforce both.
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
  },
]

export default withPayload({
  // No "X-Powered-By: Next.js, Payload" (withPayload adds it unless this is false).
  poweredByHeader: false,
  // The Docker build sets NEXT_OUTPUT=standalone: the web image then ships only the traced server
  // files (no build tooling). Local and test builds keep the regular `.next` output for `next start`.
  // The server runs the compiled chunks: TypeScript sources and project files picked up by the
  // trace are left out (withPayload adds its own drizzle-kit exclusion to the same list).
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? {
        output: 'standalone',
        outputFileTracingExcludes: {
          '**/*': [
            'src/**/*',
            'tests/**/*',
            'pnpm-lock.yaml',
            'pnpm-workspace.yaml',
            'tsconfig.json',
            'postcss.config.mjs',
          ],
        },
      }
    : {}),
  typescript: { tsconfigPath: process.env.NEXT_TSCONFIG_PATH || 'tsconfig.json' },
  distDir: process.env.NEXT_DIST_DIR || '.next',
  async headers() {
    return [
      { source: '/:path*', headers: security },
      // Never indexed, whatever PUBLIC_INDEXING says.
      { source: '/admin/:path*', headers: [noindex] },
      { source: '/admin', headers: [noindex] },
      // Set-password links (forgotten password, invitation, TOTP reset) carry the token in the path:
      // never in the Referer of the page's own requests (which Traefik logs), never cached.
      {
        source: '/admin/reset/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      // API responses (JSON, uploaded files) are never pages: nothing in them may run or load.
      {
        source: '/api/:path*',
        headers: [
          noindex,
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; sandbox",
          },
        ],
      },
      // DeckDock hub (decks module): published decks and their media, served to the add-on
      // (src/modules/decks/adapters/http/serve-route.ts). A header set here wins over the route's
      // own, so the media policy is set here: an SVG or HTML file of a deck never runs.
      {
        source: '/d/:path*',
        headers: [{ key: 'Content-Security-Policy', value: "default-src 'none'; sandbox" }],
      },
      {
        source: '/:locale/commande/acces',
        headers: [noindex, { key: 'Referrer-Policy', value: 'no-referrer' }],
      },
      {
        source: '/:locale/commande/suivi/:path*',
        headers: [
          noindex,
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
    ]
  },
})
