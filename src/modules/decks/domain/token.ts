import { sha256Hex } from './sha256'

/** Recognisable by secret scanners. */
export const TOKEN_PREFIX = 'ddk_'
const TOKEN_BYTES = 32
// 32 bytes in base64url without padding: 43 characters.
const TOKEN_FORMAT = /^ddk_[A-Za-z0-9_-]{43}$/

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

function base64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]]
    const chunk = (a << 16) | (b << 8) | c
    const chars = i + 2 < bytes.length ? 4 : i + 1 < bytes.length ? 3 : 2
    for (let k = 0; k < chars; k++) out += ALPHABET.charAt((chunk >> (18 - 6 * k)) & 63)
  }
  return out
}

/** What is stored in place of a token: the sha256 of the whole token string, in hexadecimal. */
export const hashToken = (token: string): string => sha256Hex(token)

/** A token of the shape `newPublishToken` produces; anything else is refused without a lookup. */
export const isPublishTokenFormat = (token: string): boolean => TOKEN_FORMAT.test(token)

/**
 * A new publish token: `ddk_` and 32 random bytes in base64url. The caller shows `token` once and
 * keeps only `hash`. `random` is the source of secure random bytes (injected: the domain has none).
 */
export function newPublishToken(random: (n: number) => Uint8Array): {
  token: string
  hash: string
} {
  const bytes = random(TOKEN_BYTES)
  if (bytes.length !== TOKEN_BYTES) throw new Error('random must return the requested bytes')
  const token = TOKEN_PREFIX + base64url(bytes)
  return { token, hash: hashToken(token) }
}
