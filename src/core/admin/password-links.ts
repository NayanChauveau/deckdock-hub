import { APIError, type PayloadRequest } from 'payload'
import { formatAdminURL } from 'payload/shared'
import { site } from '@/core/site'

/**
 * Set-password links (invitation, TOTP reset) reuse Payload's forgot-password token and reset page:
 * one use, 24 hours. The link and token are never logged.
 */
export const SET_PASSWORD_LINK_LIFETIME_MS = 24 * 60 * 60 * 1000

export interface EmailContent {
  subject: string
  html: string
  text: string
}

export type LinkDelivery =
  | { delivery: 'email' }
  /** Simulated email mode: nothing leaves the server, the acting administrator passes the link on. */
  | { delivery: 'link'; link: string; expiresAt: string }

export const escapeHTML = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ??
      character,
  )

/** Client IP as Traefik forwards it, for the audit logs. */
export function requestIP(req: Pick<PayloadRequest, 'headers'>): string | undefined {
  return (
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ||
    undefined
  )
}

/**
 * Issues the token for `email` and delivers the link: by email when the adapter really sends
 * (EMAIL_MODE=smtp), otherwise returned once to the caller. To be called inside the caller's
 * transaction, so that a delivery failure (502) rolls everything back.
 */
export async function issuePasswordLink(
  req: PayloadRequest,
  email: string,
  content: (link: string) => EmailContent,
): Promise<LinkDelivery> {
  const { payload } = req
  const token = await payload.forgotPassword({
    collection: 'users',
    data: { email },
    disableEmail: true,
    expiration: SET_PASSWORD_LINK_LIFETIME_MS,
    req,
  })
  if (!token) throw new APIError('Lien impossible à créer.', 500)
  const link = formatAdminURL({
    adminRoute: payload.config.routes.admin,
    path: `${payload.config.admin.routes.reset}/${token}`,
    serverURL: payload.config.serverURL,
  })
  // Never handed to an adapter that does not deliver: a fallback adapter could log the body.
  if (payload.email.name === 'smtp') {
    try {
      await payload.sendEmail({ to: email, ...content(link) })
    } catch {
      // No error detail: it could quote the message.
      throw new APIError('L’email n’a pas pu être envoyé ; rien n’a été modifié.', 502)
    }
    return { delivery: 'email' }
  }
  return {
    delivery: 'link',
    link,
    expiresAt: new Date(Date.now() + SET_PASSWORD_LINK_LIFETIME_MS).toISOString(),
  }
}

/** Sent to the account whose TOTP was reset, FR then EN. */
export function totpResetEmail(input: { name: string; link: string }): EmailContent {
  const name = escapeHTML(input.name)
  const link = escapeHTML(input.link)
  const subject =
    'Votre double authentification a été réinitialisée / Your two-factor authentication was reset'
  const html = `<p>Bonjour ${name},</p>
<p>Un autre administrateur a réinitialisé votre double authentification sur le site ${site.identity.displayName}. Votre ancien mot de passe ne fonctionne plus : choisissez-en un nouveau (12 caractères minimum) avec ce lien :</p>
<p><a href="${link}">${link}</a></p>
<p>Il ne fonctionne qu’une fois et expire dans 24 heures. Vous configurerez ensuite un nouvel appareil : gardez aussi sa clé dans votre gestionnaire de mots de passe.</p>
<p>Si vous n’êtes pas à l’origine de cette demande, prévenez immédiatement l’autre administrateur.</p>
<hr>
<p>Hello ${name},</p>
<p>Another administrator reset your two-factor authentication on the ${site.identity.displayName} website. Your old password no longer works: choose a new one (at least 12 characters) with this link:</p>
<p><a href="${link}">${link}</a></p>
<p>It works once and expires in 24 hours. You will then set up a new device: also keep its key in your password manager.</p>
<p>If you did not ask for this, tell the other administrator immediately.</p>`
  const text = [
    `Bonjour ${input.name},`,
    'Votre double authentification a été réinitialisée et votre ancien mot de passe ne fonctionne plus. Choisissez-en un nouveau (12 caractères minimum) avec ce lien, valable une fois pendant 24 heures :',
    input.link,
    'Si vous n’êtes pas à l’origine de cette demande, prévenez immédiatement l’autre administrateur.',
    '',
    `Hello ${input.name},`,
    'Your two-factor authentication was reset and your old password no longer works. Choose a new one (at least 12 characters) with this link, valid once for 24 hours:',
    input.link,
    'If you did not ask for this, tell the other administrator immediately.',
  ].join('\n')
  return { subject, html, text }
}
