import { redirect } from 'next/navigation'
import { signInPath } from '@/modules/accounts/paths'
import { deckMessages } from '../messages'
import { authorDeckSummaries, authorSpace } from '../server'
import { chooseHandleAction, createDeckAction } from './actions'
import { AuthorDecksView } from './AuthorDecksView'
import { AuthorShell } from './AuthorShell'
import { accountPage, authorMetadata } from './page-shell'
import { signedInCustomer, sitePayload } from './session'

export const generateMetadata = authorMetadata((locale) => deckMessages[locale].space.title)

/**
 * "Mes decks": the handle to choose first, then the author's decks and a form for a new one.
 * Signed-in visitors only; the others go to the sign-in page of the accounts module.
 */
export default async function AuthorDecksPage(props: { params: Promise<{ locale: string }> }) {
  return accountPage(props, async (locale) => {
    const payload = await sitePayload()
    const customerId = await signedInCustomer(payload)
    if (customerId === null) redirect(signInPath(locale))
    const { author, decks } = await authorSpace(payload, customerId)
    return (
      <AuthorShell locale={locale} current="decks">
        <AuthorDecksView
          locale={locale}
          handle={author?.handle ?? null}
          decks={await authorDeckSummaries(payload, decks, locale)}
          chooseHandle={chooseHandleAction}
          createDeck={createDeckAction}
        />
      </AuthorShell>
    )
  })
}
