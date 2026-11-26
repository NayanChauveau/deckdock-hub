import { open } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { getPayload } from 'payload'
import config from '@payload-config'
import { logger } from '@/core/logger'
import { hubDataDir } from '../../composition'
import { serveDeckFile, type ServeResult } from '../../server'
import { blobPath } from '../files/blob-store'
import { contentDisposition, etagMatches, etagOf, mediaType } from './serve-headers'

/**
 * Nothing served here may run, load or be framed, whatever its type (an SVG with a script). Also
 * set for `/d/:path*` in next.config.mjs, whose headers take precedence over a route's.
 */
const CSP = "default-src 'none'; frame-ancestors 'none'; sandbox"
const SHORT = 'public, max-age=300'
const IMMUTABLE = 'public, max-age=31536000, immutable'
const always = { 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': CSP }

const ERRORS = { 404: 'not_found', 410: 'gone', 500: 'server_error' } as const

/** A bare JSON error: the same for every unknown handle, deck, edition or file. */
const failure = (status: keyof typeof ERRORS) =>
  Response.json(
    { error: ERRORS[status] },
    { status, headers: { ...always, 'Cache-Control': 'no-store' } },
  )

/**
 * The segments after `/d/`, each percent-decoded once (`a%20b.png` → `a b.png`), from the request
 * path itself. A segment that is not valid percent-encoded UTF-8 makes the whole address unknown.
 * These strings are only compared with stored names: no filesystem path is ever built from them.
 */
function segments(request: Request): string[] | null {
  const parts = new URL(request.url).pathname.split('/')
  if (parts[0] !== '' || parts[1] !== 'd') return null
  try {
    return parts.slice(2).map((part) => decodeURIComponent(part))
  } catch {
    return null
  }
}

type Found = Exclude<ServeResult, { kind: 'missing' } | { kind: 'gone' }>

function headersOf(result: Found): Record<string, string> {
  const headers: Record<string, string> = {
    ...always,
    ETag: etagOf(result.sha256),
    'Cache-Control': result.kind === 'blob' && result.file === 'media' ? IMMUTABLE : SHORT,
  }
  if (result.noindex) headers['X-Robots-Tag'] = 'noindex'
  if (result.kind === 'blob' && result.file === 'media') {
    headers['Content-Type'] = mediaType(result.filename)
    headers['Content-Disposition'] = contentDisposition(result.filename)
    // The isolated card preview (an opaque origin) loads these files.
    headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
  } else {
    headers['Content-Type'] = 'application/json; charset=utf-8'
  }
  return headers
}

async function serve(request: Request, head: boolean): Promise<Response> {
  const parts = segments(request)
  const [handle, deckId, ...path] = parts ?? []
  if (handle === undefined || deckId === undefined) return failure(404)
  try {
    const payload = await getPayload({ config })
    const result = await serveDeckFile(payload, { handle, deckId, path })
    if (result.kind === 'missing') return failure(404)
    if (result.kind === 'gone') return failure(410)

    const headers = headersOf(result)
    if (etagMatches(request.headers.get('if-none-match'), headers['ETag'] ?? ''))
      return new Response(null, { status: 304, headers })

    // Next.js drops a route's Content-Length and sends the body chunked (send-response.ts).
    if (result.kind === 'text')
      return new Response(head ? null : result.text, { status: 200, headers })
    if (head) return new Response(null, { status: 200, headers })

    // Streamed from the content-addressed blob, never read whole into memory. The read stream
    // closes the file at its end, or when the client goes away (the web stream is cancelled).
    const file = await open(blobPath(hubDataDir(), result.sha256), 'r')
    const body = Readable.toWeb(file.createReadStream()) as unknown as ReadableStream<Uint8Array>
    return new Response(body, { status: 200, headers })
  } catch (error) {
    // No path or stack in the answer; the log has the error, not the request's full address.
    logger.error({ err: error, handle: handle.slice(0, 30) }, 'serve_failed')
    return failure(500)
  }
}

/**
 * `GET /d/<handle>/<deck-id>/index.json`, `…/<edition>/deck.json` and `…/<edition>/media/<file>`:
 * the format's "Publishing layout", which the DeckDock add-on reads from `<base>/<edition>/`.
 * Public and read-only, and not subject to the site's maintenance (like publishing): an author
 * tests a pending deck by its address before the site opens. No Range support (no Accept-Ranges).
 */
export const GET = (request: Request): Promise<Response> => serve(request, false)
export const HEAD = (request: Request): Promise<Response> => serve(request, true)
