import { getPayload } from 'payload'
import config from '@payload-config'
import { logger } from '@/core/logger'
import { previewCard } from '../../server'
import { customerIdOf } from '../payload/access'

/**
 * `GET /preview/<handle>/<deck-id>/<edition>/<note>/<side>`: one side of a preview card, as its own
 * HTML document. The author's template runs here only, under previewCSP: `sandbox allow-scripts`
 * without allow-same-origin gives it an opaque origin (no cookie, no access to the site's pages),
 * and it loads nothing but the deck's media from the hub. The deck page frames it in
 * `<iframe sandbox="allow-scripts">`. next.config.mjs leaves this path out of its baseline policy,
 * whose headers would otherwise replace this route's.
 */
const NOT_FOUND = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } as const

const missing = () =>
  new Response('Not found', {
    status: 404,
    headers: {
      ...NOT_FOUND,
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  })

/** The five segments after `/preview/`, percent-decoded once, or `null`. */
function segments(request: Request): string[] | null {
  const parts = new URL(request.url).pathname.split('/')
  if (parts[0] !== '' || parts[1] !== 'preview' || parts.length !== 7) return null
  try {
    return parts.slice(2).map((part) => decodeURIComponent(part))
  } catch {
    return null
  }
}

export async function GET(request: Request): Promise<Response> {
  const parts = segments(request)
  if (!parts) return missing()
  const [handle = '', deckId = '', edition = '', index = '', side = ''] = parts
  try {
    const payload = await getPayload({ config })
    // Read only for a pending deck, which its author alone may preview.
    const viewer = async () => customerIdOf((await payload.auth({ headers: request.headers })).user)
    const result = await previewCard(payload, { handle, deckId, edition, index, side, viewer })
    if (result.kind === 'missing') return missing()
    return new Response(result.html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': result.csp,
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex',
        'Cache-Control': result.public ? 'public, max-age=300' : 'private, no-store',
      },
    })
  } catch (err) {
    logger.error({ err, handle }, 'preview_failed')
    return new Response('Server error', {
      status: 500,
      headers: { ...NOT_FOUND, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
