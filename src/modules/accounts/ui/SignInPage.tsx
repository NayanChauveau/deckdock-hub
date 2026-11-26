import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { Notice } from '@/core/ui/feedback/Notice'
import { accountMessages } from '../messages'
import { accountPath, asDeletionLinkError, deletionLinkError, tooManyError } from '../paths'
import { visitorSession } from '../server'
import { AccountCard } from './AccountCard'
import { SignInForm } from './SignInForm'
import { accountMetadata, accountPage, errorParam, type AccountPageProps } from './page-shell'

export const generateMetadata = accountMetadata('signIn')

/**
 * Sign-in by magic link, in a centered card (« lien envoyé » is the form's own state). A used or
 * expired link comes back here with Better Auth's `?error=`, shown at the top of the card; a
 * visitor already signed in goes to their account (with the error of a failed deletion link, or of
 * one refused by the rate limit).
 */
export default async function SignInPage(props: AccountPageProps) {
  return accountPage(props, async (locale) => {
    const error = await errorParam(props)
    const linkError = asDeletionLinkError(error)
    if (await visitorSession(await headers()))
      redirect(linkError ? `${accountPath(locale)}?error=${linkError}` : accountPath(locale))
    const t = accountMessages[locale]
    const notice =
      error === deletionLinkError
        ? t.account.deletionLinkError
        : error === tooManyError
          ? t.signIn.tooMany
          : error && t.signIn.linkError
    return (
      <AccountCard title={t.signIn.title} lead={t.signIn.intro}>
        {notice && <Notice tone="error">{notice}</Notice>}
        <SignInForm locale={locale} />
      </AccountCard>
    )
  })
}
