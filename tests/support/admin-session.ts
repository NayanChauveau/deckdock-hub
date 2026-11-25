import assert from 'node:assert/strict'
import { newTotpSecret, totpCode } from './totp'

/** Cookie value set by a response, if any. */
export function setCookie(response: Response, name: string): string | undefined {
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(';')
    const [key, ...value] = (pair ?? '').split('=')
    if (key?.trim() === name) return value.join('=')
  }
  return undefined
}

export interface AdminSession {
  /** Cookie header to send: password session, plus the TOTP cookie once a code was entered. */
  cookie: string
  secret: string
}

/** Same-origin headers, as a browser sends them: Payload ignores cross-site auth cookies. */
export const sameOrigin = (origin: string, cookie: string, json = false) => ({
  Cookie: cookie,
  Origin: origin,
  'Sec-Fetch-Site': 'same-origin',
  ...(json ? { 'Content-Type': 'application/json' } : {}),
})

/** Password step only: the session payload-totp holds back until a code is entered. */
export async function passwordLogin(origin: string, email: string, password: string) {
  const response = await fetch(`${origin}/api/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  assert.equal(response.status, 200, `Connexion par mot de passe de ${email}`)
  const token = setCookie(response, 'payload-token')
  assert.ok(token, 'Cookie de session')
  return `payload-token=${token}`
}

/** Enrolment (no secret yet) or verification (known secret) through the plugin endpoints. */
export async function totpLogin(
  origin: string,
  email: string,
  password: string,
  secret?: string,
): Promise<AdminSession> {
  const cookie = await passwordLogin(origin, email, password)
  const key = secret ?? newTotpSecret()
  const response = await fetch(`${origin}/api/${secret ? 'verify' : 'setup'}-totp`, {
    method: 'POST',
    headers: sameOrigin(origin, cookie, true),
    body: JSON.stringify(secret ? { token: totpCode(key) } : { secret: key, token: totpCode(key) }),
  })
  assert.deepEqual(await response.json(), { ok: true }, `Code TOTP accepté pour ${email}`)
  const totp = setCookie(response, 'payload-totp')
  assert.ok(totp, 'Cookie TOTP')
  return { cookie: `${cookie}; payload-totp=${totp}`, secret: key }
}
