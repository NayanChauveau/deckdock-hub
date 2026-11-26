import Link from 'next/link'
import type { Locale } from '@/core/i18n/locales'
import { Notice } from '@/core/ui/feedback/Notice'
import { accountMessages } from '../messages'
import type { AccountLink } from '../extension'
import { tooManyError, type DeletionLinkError } from '../paths'
import { AccountActions } from './AccountActions'
import { card } from './AccountCard'

const pill =
  'inline-flex min-h-10 max-w-full items-center rounded-full border border-border bg-card px-4 text-sm font-medium wrap-anywhere hover:text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/** "Mon compte": the visitor's address, the pages of their account, then what they can do. */
export function AccountView({
  locale,
  email,
  linkError,
  links = [],
  navigate,
}: {
  locale: Locale
  email: string
  /** Back from a deletion link that deleted nothing (`?error=deletion_link`, or `too_many`). */
  linkError?: DeletionLinkError | undefined
  /** Pages other modules add to the account (for example the author space). */
  links?: readonly AccountLink[]
  /** Tests only: where the actions go once signed out. */
  navigate?: (url: string) => void
}) {
  const messages = accountMessages[locale]
  const t = messages.account
  return (
    <div className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h1>
      {linkError && (
        <Notice tone="error">
          {linkError === tooManyError ? messages.signIn.tooMany : t.deletionLinkError}
        </Notice>
      )}
      <div className={`${card} flex flex-col gap-4`}>
        <p className="text-sm">
          {t.signedInAs} <strong className="font-semibold break-all">{email}</strong>
        </p>
        {links.length > 0 && (
          <nav aria-label={t.linksLabel}>
            <ul className="flex flex-wrap gap-2">
              {links.map((link) => (
                <li key={link.href} className="max-w-full">
                  <Link href={link.href} className={pill}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>
      <AccountActions locale={locale} email={email} {...(navigate ? { navigate } : {})} />
    </div>
  )
}
