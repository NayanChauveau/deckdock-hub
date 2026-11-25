import { logger } from '@/core/logger'
import { RequestError } from '@/core/http/request-guards'
import { OrderError } from '../../domain/errors'

const statuses: Record<string, number> = {
  not_found: 404,
  reference: 404,
  origin: 403,
  too_large: 413,
  rate_limit: 429,
  closed: 409,
  prices_unavailable: 409,
  expired: 409,
  attempt: 409,
  quote_changed: 409,
  payment_mismatch: 409,
  payment_unavailable: 503,
  webhook_unavailable: 503,
}

/** An error class whose instances carry a semantic `code` (OrderError, a module's own errors). */
export type CodedError = abstract new (...args: never[]) => Error & { code: string }

/**
 * The JSON answer of an order route. Known errors (orders, request guards and the `known` classes
 * a module adds, e.g. its upload errors) answer their code; anything else is logged and hidden.
 */
export function errorResponse(error: unknown, known: readonly CodedError[] = []) {
  const coded =
    error instanceof OrderError ||
    error instanceof RequestError ||
    known.some((type) => error instanceof type)
      ? (error as Error & { code: string })
      : null
  // Message and stack only, never the request: it may hold customer data.
  if (!coded) logger.error({ err: error }, 'commerce_request_failed')
  const status = coded ? (statuses[coded.code] ?? 400) : 503
  return Response.json(
    { error: coded ? coded.code : 'unavailable' },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        ...(status === 429 ? { 'Retry-After': '3600' } : {}),
      },
    },
  )
}
