import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { getPayload } from 'payload'
import config from '@payload-config'
import { privateHeaders } from '@/core/http/request-guards'
import { logger } from '@/core/logger'
import type { PublishBody } from '../../application/publish'
import { UploadAborted } from '../files/workspace'
import { publishEdition } from '../../server'

const headers = (extra: Record<string, string> = {}) => ({
  ...privateHeaders,
  'X-Content-Type-Options': 'nosniff',
  ...extra,
})

/** The token of `Authorization: Bearer <token>`, or '' (refused as any wrong token). */
function bearer(request: Request): string {
  const match = /^Bearer[ ]+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '')
  return match?.[1] ?? ''
}

function declaredLength(request: Request): number | null {
  const raw = request.headers.get('content-length')
  if (raw === null || !/^\d+$/.test(raw.trim())) return null
  return Number(raw.trim())
}

const serverError = (): PublishBody => ({
  status: 'rejected',
  version: '',
  notes: 0,
  warnings: [],
  errors: [{ where: 'server', message: 'The hub could not process this upload. Try again later.' }],
})

/**
 * `POST /api/publish/<edition>`: a deck's CI sends one compiled edition as a tar.gz body, with the
 * deck's publish token. Always answers JSON in the shape the DeckDock Action reads, never a stack
 * or a server path. Not subject to the site's maintenance: authors publish before the site opens.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ edition: string }> },
): Promise<Response> {
  const { edition } = await context.params
  try {
    const payload = await getPayload({ config })
    const body = request.body
      ? Readable.fromWeb(request.body as unknown as NodeReadableStream<Uint8Array>)
      : null
    // A client that goes away before the body is read (for instance while waiting for a publish
    // slot) must not crash the process with an unhandled 'error': the workspace sees `errored`.
    body?.on('error', () => undefined)
    const result = await publishEdition(payload, {
      token: bearer(request),
      edition,
      archive: { body, declaredLength: declaredLength(request) },
    })
    return Response.json(result.body, {
      status: result.httpStatus,
      headers: headers(
        result.retryAfter === undefined ? {} : { 'Retry-After': String(result.retryAfter) },
      ),
    })
  } catch (error) {
    // The token never reaches the logs: only the edition and the error.
    if (error instanceof UploadAborted) {
      // The workspace was cleaned up; the client is gone, the answer is a formality.
      logger.warn({ edition: edition.slice(0, 100) }, 'publish_upload_aborted')
      return Response.json(
        {
          ...serverError(),
          errors: [{ where: 'archive', message: 'The upload was interrupted.' }],
        },
        { status: 400, headers: headers() },
      )
    }
    logger.error({ err: error, edition: edition.slice(0, 100) }, 'publish_failed')
    return Response.json(serverError(), { status: 500, headers: headers() })
  }
}
