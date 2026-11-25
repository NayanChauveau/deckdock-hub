/** One visitor email: who receives it, in which language, and the link itself (a credential). */
export interface AccountLinkMessage {
  to: string
  locale: string
  url: string
}

/**
 * Port: the visitor's emails, sent right away. No outbox: each link is only worth something for a
 * short while (15 minutes to sign in, 24 hours to confirm a deletion), and it must never be stored
 * or logged in clear.
 */
export interface AccountEmails {
  sendSignInLink(message: AccountLinkMessage): Promise<void>
  /** The link that confirms the deletion of the account (Better Auth's delete verification). */
  sendDeletionLink(message: AccountLinkMessage): Promise<void>
}

export interface LocaleSettings {
  locales: readonly string[]
  defaultLocale: string
}

export interface SignInLinkSettings extends LocaleSettings {
  /** The sign-in page of a language: a used or expired link lands there with `?error=`. */
  signInPath(locale: string): string
}

/** The language of the page the visitor returns to (`/{locale}/compte`), the site default otherwise. */
export function callbackLocale(callbackURL: string | null, settings: LocaleSettings): string {
  if (!callbackURL) return settings.defaultLocale
  let pathname: string
  try {
    pathname = new URL(callbackURL, 'http://localhost').pathname
  } catch {
    return settings.defaultLocale
  }
  const first = pathname.split('/')[1] ?? ''
  return settings.locales.includes(first) ? first : settings.defaultLocale
}

/**
 * Sends the link Better Auth built for `email`. Unless the caller chose its own error page, a link
 * opened twice or too late leads to the sign-in page of the visitor's language, not to the
 * account page it was meant for.
 */
export async function requestSignInLink(
  request: { email: string; url: string },
  emails: AccountEmails,
  settings: SignInLinkSettings,
): Promise<void> {
  const link = new URL(request.url)
  const locale = callbackLocale(link.searchParams.get('callbackURL'), settings)
  if (!link.searchParams.has('errorCallbackURL'))
    link.searchParams.set('errorCallbackURL', settings.signInPath(locale))
  await emails.sendSignInLink({ to: request.email, locale, url: link.toString() })
}
