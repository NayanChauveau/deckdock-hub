import type { Locale } from '@/core/i18n/locales'
import { Notice } from '@/core/ui/feedback/Notice'
import { accountMessages } from '../messages'
import { tooManyError, type DeletionLinkError } from '../paths'
import { AccountActions } from './AccountActions'

/** "Mon compte": the visitor's address and what they can do with their account. */
export function AccountView({
  locale,
  email,
  linkError,
  navigate,
}: {
  locale: Locale
  email: string
  /** Back from a deletion link that deleted nothing (`?error=deletion_link`, or `too_many`). */
  linkError?: DeletionLinkError | undefined
  /** Tests only: where the actions go once signed out. */
  navigate?: (url: string) => void
}) {
  const messages = accountMessages[locale]
  const t = messages.account
  return (
    <main className="commerce-page flex flex-col gap-8">
      <h1>{t.title}</h1>
      {linkError && (
        <Notice tone="error">
          {linkError === tooManyError ? messages.signIn.tooMany : t.deletionLinkError}
        </Notice>
      )}
      <p>
        {t.signedInAs} <strong className="break-all">{email}</strong>
      </p>
      <AccountActions locale={locale} email={email} {...(navigate ? { navigate } : {})} />
    </main>
  )
}
