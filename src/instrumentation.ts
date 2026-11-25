import type { NextErrorContext, NextRequestInfo } from './core/http/request-error'

/** Next.js instrumentation: every unhandled request error becomes one JSON log line with its stack. */
export async function onRequestError(
  error: unknown,
  request: NextRequestInfo,
  context: NextErrorContext,
) {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return
  const [{ reportRequestError }, { logger }] = await Promise.all([
    import('./core/http/request-error'),
    import('./core/logger'),
  ])
  reportRequestError(logger, error, request, context)
}
