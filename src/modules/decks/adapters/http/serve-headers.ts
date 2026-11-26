import { encodeSegment } from '../../domain/serving'

/**
 * Media types by extension, a fixed allowlist: images, audio, video, fonts, CSS, JSON and plain
 * text. Anything else is `application/octet-stream`, so a deck can never get a file served as
 * `text/html` (or as script). SVG is listed, and is always served with a sandbox CSP.
 */
const MEDIA_TYPES: Readonly<Record<string, string>> = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  weba: 'audio/webm',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  css: 'text/css; charset=utf-8',
  json: 'application/json',
  txt: 'text/plain; charset=utf-8',
})

export function mediaType(filename: string): string {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return 'application/octet-stream'
  const extension = filename.slice(dot + 1).toLowerCase()
  return Object.hasOwn(MEDIA_TYPES, extension)
    ? (MEDIA_TYPES[extension] ?? 'application/octet-stream')
    : 'application/octet-stream'
}

/** `inline; filename*=UTF-8''<percent-encoded>` (RFC 6266 / 5987): any name is header-safe. */
export const contentDisposition = (filename: string): string =>
  `inline; filename*=UTF-8''${encodeSegment(filename)}`

/** The strong ETag of a stored file or of index.json: its sha256, quoted. */
export const etagOf = (sha256: string): string => `"${sha256}"`

/**
 * Whether `If-None-Match` matches `etag` (RFC 9110 §13.1.2: `*`, or a list of entity tags
 * compared weakly, so `W/"x"` matches `"x"`).
 */
export function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false
  if (header.trim() === '*') return true
  const opaque = etag.replace(/^W\//, '')
  return header
    .split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === opaque)
}
