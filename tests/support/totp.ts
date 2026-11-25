import { createHmac, randomBytes } from 'node:crypto'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/** A fresh base32 secret, as an authenticator app would store it. */
export function newTotpSecret(): string {
  let bits = ''
  for (const byte of randomBytes(20)) bits += byte.toString(2).padStart(8, '0')
  return (bits.match(/.{5}/g) ?? []).map((chunk) => ALPHABET[parseInt(chunk, 2)]).join('')
}

function base32Decode(secret: string): Buffer {
  let bits = ''
  for (const character of secret.replace(/[\s=]/g, '').toUpperCase()) {
    const value = ALPHABET.indexOf(character)
    if (value < 0) throw new Error('Clé base32 invalide')
    bits += value.toString(2).padStart(5, '0')
  }
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)))
}

/** RFC 6238 code (SHA-1, 6 digits, 30 s), the settings payload-totp uses. */
export function totpCode(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)))
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = (digest.at(-1) ?? 0) & 0xf
  const value = digest.readUInt32BE(offset) & 0x7fffffff
  return String(value % 1_000_000).padStart(6, '0')
}
