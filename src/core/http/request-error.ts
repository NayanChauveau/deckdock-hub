import type { Logger } from 'pino'

/** Shapes of Next.js `onRequestError` arguments (instrumentation hook). */
export interface NextRequestInfo {
  path: string
  method: string
  headers: Record<string, string | string[] | undefined>
}
export interface NextErrorContext {
  routerKind: string
  routePath: string
  routeType: string
}

/**
 * Logs an error Next.js did not handle (page render, route handler, server action) as one JSON
 * line with its stack. The query string is dropped: it may carry tokens or user input.
 */
export function reportRequestError(
  log: Logger,
  error: unknown,
  request: NextRequestInfo,
  context: NextErrorContext,
) {
  const digest =
    error && typeof error === 'object' && 'digest' in error && typeof error.digest === 'string'
      ? error.digest
      : undefined
  log.error(
    {
      err: error,
      method: request.method,
      path: request.path.split('?')[0],
      routePath: context.routePath,
      routeType: context.routeType,
      digest,
    },
    'request_failed',
  )
}
