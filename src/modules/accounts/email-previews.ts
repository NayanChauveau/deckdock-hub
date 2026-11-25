import { site as siteConfig } from '@/core/site'
import { renderDeletionEmail, renderSignInEmail } from './adapters/email/account-emails'
import { accountPath, deletedPath } from './paths'

/** The sign-in and deletion emails in both languages, with links that open nothing (no such token). */
export function emailPreviews(siteURL: string) {
  const origin = new URL(siteURL).origin
  const preview = (path: string, callbackURL: string) => {
    const url = new URL(path, origin)
    url.searchParams.set('token', 'APERCU')
    url.searchParams.set('callbackURL', callbackURL)
    return url.toString()
  }
  const to = 'camille@example.com'
  const name = siteConfig.identity.displayName
  return (['fr', 'en'] as const).flatMap((locale) =>
    [
      renderSignInEmail(
        { to, locale, url: preview('/api/auth/magic-link/verify', accountPath(locale)) },
        name,
      ),
      renderDeletionEmail(
        { to, locale, url: preview('/api/auth/delete-user/callback', deletedPath(locale)) },
        name,
      ),
    ].map((email) => ({
      subject: `[Aperçu] ${email.subject}`,
      body: email.text,
      html: email.html,
    })),
  )
}
