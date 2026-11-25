/** A request refused before reaching any module (origin, size, body). */
export class RequestError extends Error {
  constructor(public readonly code: 'origin' | 'too_large' | 'invalid_request') {
    super(code)
    this.name = 'RequestError'
  }
}

export function sameOrigin(request: Request) {
  if (request.headers.get('origin') !== process.env['APP_URL']) throw new RequestError('origin')
}
export async function boundedBody(request: Request, max: number) {
  if (Number(request.headers.get('content-length') || 0) > max) throw new RequestError('too_large')
  const reader = request.body?.getReader()
  if (!reader) throw new RequestError('invalid_request')
  let size = 0
  const chunks: Buffer[] = []
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.length
      if (size > max) throw new RequestError('too_large')
      chunks.push(Buffer.from(value))
    }
  } finally {
    await reader.cancel().catch(() => {
      /* Reader may already be cancelled after a transport failure. */
    })
  }
  return Buffer.concat(chunks)
}

export function requestIdentity(request: Request) {
  return (
    request.headers.get('x-real-ip') ||
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ||
    'unknown'
  )
}

export const privateHeaders = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
}
