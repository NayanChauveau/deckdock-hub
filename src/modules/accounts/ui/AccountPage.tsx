import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { asDeletionLinkError, signInPath } from '../paths'
import { accountLinks, visitorSession } from '../server'
import { AccountView } from './AccountView'
import { accountMetadata, accountPage, errorParam, type AccountPageProps } from './page-shell'

export const generateMetadata = accountMetadata('account')

/** "Mon compte", for a signed-in visitor; the others go to the sign-in page. */
export default async function AccountPage(props: AccountPageProps) {
  return accountPage(props, async (locale) => {
    const linkError = asDeletionLinkError(await errorParam(props))
    const visitor = await visitorSession(await headers())
    if (!visitor)
      redirect(linkError ? `${signInPath(locale)}?error=${linkError}` : signInPath(locale))
    return (
      <AccountView
        locale={locale}
        email={visitor.email}
        linkError={linkError}
        links={await accountLinks(locale)}
      />
    )
  })
}
