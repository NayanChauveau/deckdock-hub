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
import { isVerifiedAdmin } from '@/core/payload/access'
import {
  SET_PASSWORD_LINK_LIFETIME_MS,
  escapeHTML,
  issuePasswordLink,
  requestIP,
} from './password-links'
import { site } from '@/core/site'

/** An invitation link opens Payload's reset-password page; it works once, within 24 hours. */
export const INVITATION_LIFETIME_MS = SET_PASSWORD_LINK_LIFETIME_MS

export type InvitationResult =
  | { email: string; delivery: 'email' }
  /** Simulated email mode: nothing leaves the server, the inviting administrator passes the link on. */
  | { email: string; delivery: 'link'; link: string; expiresAt: string }

function parseInvitation(input: unknown): { email: string; name: string } {
  const record = typeof input === 'object' && input !== null ? input : {}
  const email =
    'email' in record && typeof record.email === 'string' ? record.email.trim().toLowerCase() : ''
  const name = 'name' in record && typeof record.name === 'string' ? record.name.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new APIError('Email invalide.', 400)
  if (!name || name.length > 100) throw new APIError('Nom requis (100 caractères maximum).', 400)
  return { email, name }
}

/** FR then EN: the invitee may read either; the link is the same. */
export function invitationEmail(input: { name: string; link: string }) {
  const name = escapeHTML(input.name)
  const link = escapeHTML(input.link)
  const subject = `Invitation à l’administration du site ${site.identity.displayName} / Invitation to the ${site.identity.displayName} site administration`
  const html = `<p>Bonjour ${name},</p>
<p>Vous êtes invité(e) à administrer le site ${site.identity.displayName}. Ce lien vous permet de choisir votre mot de passe (12 caractères minimum) :</p>
<p><a href="${link}">${link}</a></p>
<p>Il ne fonctionne qu’une fois et expire dans 24 heures. À la première connexion, vous configurerez la double authentification avec une application d’authentification : gardez aussi sa clé dans votre gestionnaire de mots de passe.</p>
<p>Si vous n’attendiez pas cette invitation, ignorez cet email : aucun accès n’est ouvert sans ce lien.</p>
<hr>
<p>Hello ${name},</p>
<p>You have been invited to administer the ${site.identity.displayName} website. This link lets you choose your password (at least 12 characters):</p>
<p><a href="${link}">${link}</a></p>
<p>It works once and expires in 24 hours. At your first sign-in you will set up two-factor authentication with an authenticator app: also keep its key in your password manager.</p>
<p>If you were not expecting this invitation, ignore this email: no access is granted without this link.</p>`
  const text = [
    `Bonjour ${input.name},`,
    `Vous êtes invité(e) à administrer le site ${site.identity.displayName}. Choisissez votre mot de passe (12 caractères minimum) avec ce lien, valable une fois pendant 24 heures :`,
    input.link,
    'À la première connexion, vous configurerez la double authentification : gardez aussi sa clé dans votre gestionnaire de mots de passe.',
    'Si vous n’attendiez pas cette invitation, ignorez cet email.',
    '',
    `Hello ${input.name},`,
    `You have been invited to administer the ${site.identity.displayName} website. Choose your password (at least 12 characters) with this link, valid once for 24 hours:`,
    input.link,
    'At your first sign-in you will set up two-factor authentication: also keep its key in your password manager.',
    'If you were not expecting this invitation, ignore this email.',
  ].join('\n')
  return { subject, html, text }
}

/**
 * Creates an administrator account from an email and a name, with a random password nobody knows,
 * then issues Payload's own reset-password token (forgot-password mechanism, 24 h) as the
 * invitation link. With real email delivery the link is sent and never returned; otherwise it is
 * returned once to the inviting administrator. The link and token are never logged.
 */
export async function inviteAdministrator(
  req: PayloadRequest,
  input: unknown,
): Promise<InvitationResult> {
  if (!(await isVerifiedAdmin(req))) throw new Forbidden(req.t)
  const { email, name } = parseInvitation(input)
  const { payload } = req
  if ((await payload.count({ collection: 'users', where: { email: { equals: email } } })).totalDocs)
    throw new APIError('Un compte existe déjà avec cet email.', 409)
  const shouldCommit = await initTransaction(req)
  try {
    // Access enforced again by the collection (administrator with a TOTP-verified session).
    const invitee = await payload.create({
      collection: 'users',
      overrideAccess: false,
      req,
      data: { email, name, role: 'admin', password: randomBytes(32).toString('hex') },
    })
    const result = await issuePasswordLink(req, email, (link) => invitationEmail({ name, link }))
    if (shouldCommit) await commitTransaction(req)
    // Identifiers only: no email, link or token in the logs.
    payload.logger.info(
      {
        invitee: invitee.id,
        invitedBy: req.user?.id,
        ip: requestIP(req),
        delivery: result.delivery,
      },
      'Invitation administrateur créée.',
    )
    return { email, ...result }
  } catch (error) {
    await killTransaction(req)
    throw error
  }
}

export const inviteEndpoint: Endpoint = {
  path: '/invite',
  method: 'post',
  handler: async (req) => {
    let body: unknown = null
    try {
      body = await req.json?.()
    } catch {
      body = null
    }
    try {
      const result = await inviteAdministrator(req, body)
      return Response.json(result, { status: 201, headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      if (error instanceof APIError)
        return Response.json({ message: error.message }, { status: error.status })
      throw error
    }
  },
}
