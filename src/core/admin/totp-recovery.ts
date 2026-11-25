import { randomBytes } from 'node:crypto'
import {
  APIError,
  Forbidden,
  commitTransaction,
  initTransaction,
  killTransaction,
  type Endpoint,
  type PayloadRequest,
} from 'payload'
import { isTotpVerifiedAdmin } from '@/core/payload/access'
import { issuePasswordLink, requestIP, totpResetEmail, type LinkDelivery } from './password-links'

/** Serial ids: no leading zero (it would dodge the self-reset check), within PostgreSQL's integer. */
const MAX_ID = 2_147_483_647
const parseID = (value: unknown): number | undefined => {
  const raw = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (!/^[1-9]\d{0,9}$/.test(raw)) return undefined
  const id = Number(raw)
  return id <= MAX_ID ? id : undefined
}

/**
 * "Phone lost": another administrator, whose own session passed TOTP, clears a user's secret,
 * closes their sessions and replaces their password with an unknown one. A 24-hour single-use
 * set-password link (emailed with EMAIL_MODE=smtp, otherwise returned once to the acting
 * administrator) is the only way back in, so re-enrolment needs a fresh channel rather than a
 * possibly compromised old password. Never for one's own account, never without a code.
 */
export async function resetUserTotp(req: PayloadRequest, targetID: unknown): Promise<LinkDelivery> {
  if (!isTotpVerifiedAdmin(req) || !req.user) throw new Forbidden(req.t)
  const actor = req.user
  const id = parseID(targetID)
  if (id === undefined) throw new APIError('Compte introuvable.', 404)
  const { payload } = req
  const target = await payload.findByID({
    collection: 'users',
    id,
    depth: 0,
    disableErrors: true,
    overrideAccess: true,
  })
  if (!target) throw new APIError('Compte introuvable.', 404)
  if (String(target.id) === String(actor.id))
    throw new APIError(
      'Impossible de réinitialiser sa propre double authentification : demander à un autre administrateur.',
      403,
    )
  const shouldCommit = await initTransaction(req)
  try {
    // The secret field is closed to every access by the plugin: written with access overridden, as
    // the plugin's own endpoints do. Emptying the sessions makes the user's JWTs invalid; an old
    // TOTP cookie no longer counts either, since the account has no secret (src/core/admin/totp.ts).
    await payload.update({
      collection: 'users',
      id: target.id,
      overrideAccess: true,
      req,
      data: {
        totpSecret: null,
        sessions: [],
        password: randomBytes(32).toString('hex'),
        // A lock caused by wrong codes from the lost device is lifted too.
        loginAttempts: 0,
        lockUntil: null,
      },
    })
    await payload.delete({
      collection: 'totp-attempts',
      overrideAccess: true,
      req,
      where: { id: { equals: String(target.id) } },
    })
    const result = await issuePasswordLink(req, target.email, (link) =>
      totpResetEmail({ name: target.name, link }),
    )
    if (shouldCommit) await commitTransaction(req)
    payload.logger.warn(
      { target: target.id, resetBy: actor.id, ip: requestIP(req), delivery: result.delivery },
      'Double authentification réinitialisée par un administrateur.',
    )
    return result
  } catch (error) {
    await killTransaction(req)
    throw error
  }
}

export const resetTotpEndpoint: Endpoint = {
  path: '/:id/reset-totp',
  method: 'post',
  handler: async (req) => {
    try {
      const result = await resetUserTotp(req, req.routeParams?.['id'])
      return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof APIError)
        return Response.json({ message: error.message }, { status: error.status })
      throw error
    }
  },
}
