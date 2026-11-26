import type { Logger } from 'pino'

/**
 * Content Security Policy of the HTML pages (public site and administration), set by the proxy
 * with a fresh nonce per request. Next.js reads the nonce from the request header and puts it on
 * its own scripts; anything else (an injected <script>, an inline handler, a script from another
 * site) is refused, and the browser reports it to CSP_REPORT_PATH.
 *
 * Public pages load nothing from other sites, so 'strict-dynamic' trusts only what the nonced
 * scripts load. The one exception is the audience measurement, when configured
 * (src/core/http/analytics.ts): its origin is added to script-src (for browsers without
 * 'strict-dynamic'; the tag carries the nonce) and to connect-src (the tracker posts the visits). The administration also loads the Monaco editor (Payload's JSON fields, e.g. the
 * order history) from jsDelivr, pinned to the version Payload ships (checked by tests/csp.test.ts).
 */
export const CSP_REPORT_PATH = '/api/csp-report'
export const MONACO_CDN = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs/'

export function contentSecurityPolicy({
  nonce,
  admin,
  dev,
  analytics = null,
}: {
  nonce: string
  admin: boolean
  dev: boolean
  /** Origin of the audience measurement; public pages only. */
  analytics?: string | null
}): string {
  const cdn = admin ? [MONACO_CDN] : []
  const measurement = analytics && !admin ? [analytics] : []
  // React rebuilds server error stacks with eval in development only.
  const evalInDev = dev ? ["'unsafe-eval'"] : []
  const scripts = admin
    ? ["'self'", `'nonce-${nonce}'`, ...cdn]
    : ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...measurement]
  return [
    "default-src 'self'",
    `script-src ${[...scripts, ...evalInDev].join(' ')}`,
    // Inline style attributes (React, Payload) are not a script vector; style tags stay allowed too.
    `style-src ${["'self'", "'unsafe-inline'", ...cdn].join(' ')}`,
    "img-src 'self' data: blob:",
    `font-src ${["'self'", 'data:', ...cdn].join(' ')}`,
    `connect-src ${["'self'", ...measurement].join(' ')}`,
    "worker-src 'self' blob:",
    // Public pages may frame the site's own documents (the DeckDock card previews, sandboxed);
    // the administration frames nothing.
    `frame-src ${admin ? "'none'" : "'self'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    `report-uri ${CSP_REPORT_PATH}`,
    'report-to csp',
  ].join('; ')
}

/** 128 random bits, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}

export interface CspViolation {
  directive: string
  /** Origin of the blocked resource, or the browser's keyword ("inline", "eval", "data"…). */
  blocked: string
  /** Path of the page, without query; set-password tokens removed. */
  page: string
}

const MAX_PER_BODY = 10
const field = (value: unknown) => (typeof value === 'string' ? value.slice(0, 200) : '')

function origin(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : url.protocol.replace(':', '')
  } catch {
    return value
  }
}

function pagePath(value: string): string {
  let path = value
  try {
    path = new URL(value).pathname
  } catch {
    path = value.split(/[?#]/)[0] ?? ''
  }
  // Set-password tokens and order references (private tracking links) never reach the logs.
  return path
    .replace(/\/reset\/[0-9a-fA-F]{40}/g, '/reset/REDACTED')
    .replace(/\/suivi\/[^/]+/g, '/suivi/REDACTED')
}

/** The body as text, or null past `limit` bytes: read as a stream, so a chunked body without a
 * Content-Length is never buffered beyond the limit. */
async function readCapped(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

/** Both report formats: report-uri ({"csp-report": {...}}) and the Reporting API ([{type, body}]). */
export function summarizeCspReports(text: string): CspViolation[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const bodies: Record<string, unknown>[] = []
  if (Array.isArray(parsed)) {
    for (const entry of parsed as unknown[]) {
      if (!entry || typeof entry !== 'object') continue
      const { type, body } = entry as { type?: unknown; body?: unknown }
      if (type === 'csp-violation' && body && typeof body === 'object')
        bodies.push(body as Record<string, unknown>)
    }
  } else if (parsed && typeof parsed === 'object' && 'csp-report' in parsed) {
    const report = parsed['csp-report']
    if (report && typeof report === 'object') bodies.push(report as Record<string, unknown>)
  }
  return bodies.slice(0, MAX_PER_BODY).map((body) => ({
    directive: field(
      body['effectiveDirective'] ?? body['effective-directive'] ?? body['violated-directive'],
    ),
    blocked: origin(field(body['blockedURL'] ?? body['blocked-uri'])),
    page: pagePath(field(body['documentURL'] ?? body['document-uri'])),
  }))
}

const MAX_BODY_BYTES = 16 * 1024

/**
 * POST handler of CSP_REPORT_PATH: one "csp violation" warning per report (Grafana filters on the
 * level), at most `perMinute` per minute so that nobody can flood the logs; always 204 otherwise.
 */
export function createCspReportHandler({
  log,
  now = Date.now,
  perMinute = 60,
}: {
  log: Logger
  now?: () => number
  perMinute?: number
}) {
  let windowStart = 0
  let logged = 0
  return async function handle(request: Request): Promise<Response> {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES)
      return new Response(null, { status: 413 })
    const text = await readCapped(request, MAX_BODY_BYTES)
    if (text === null) return new Response(null, { status: 413 })
    const time = now()
    if (time - windowStart >= 60_000) {
      windowStart = time
      logged = 0
    }
    for (const violation of summarizeCspReports(text)) {
      if (logged >= perMinute) break
      logged++
      log.warn(violation, 'csp violation')
    }
    return new Response(null, { status: 204 })
  }
}
