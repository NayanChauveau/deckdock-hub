import { notFound, redirect } from 'next/navigation'
import { signInPath } from '@/modules/accounts/paths'
import { deckMessages } from '../messages'
import { authorDeck, authorDeckSummaries, DecksError } from '../server'
import { regenerateTokenAction, revokeTokenAction } from './actions'
import { AuthorDeckView } from './AuthorDeckView'
import { AuthorShell } from './AuthorShell'
import { accountPage, authorMetadata } from './page-shell'
import { signedInCustomer, sitePayload } from './session'

export const generateMetadata = authorMetadata((locale) => deckMessages[locale].space.title)

interface Props {
  params: Promise<{ locale: string; deckId: string }>
}

/**
 * One deck of the author: its status, the first-publish guide until a version is received, its
 * editions and received versions with their test address, its token (regenerate, revoke) and the
 * CI settings. Another author's deck is a 404.
 */
export default async function AuthorDeckPage(props: Props) {
  return accountPage(props, async (locale) => {
    const payload = await sitePayload()
    const customerId = await signedInCustomer(payload)
    if (customerId === null) redirect(signInPath(locale))
    const { deckId } = await props.params
    const { author, deck, editions } = await authorDeck(payload, customerId, deckId).catch(
      (error: unknown) => {
        if (error instanceof DecksError && error.code === 'not_found') notFound()
        throw error
      },
    )
    const [summary] = await authorDeckSummaries(payload, [deck], locale)
    if (!summary) notFound()
    return (
      <AuthorShell locale={locale} current="decks">
        <AuthorDeckView
          locale={locale}
          // The hub's public address (`serverURL`): the value of DECKDOCK_HUB_URL.
          origin={payload.config.serverURL}
          handle={author.handle}
          deck={deck}
          summary={summary}
          editions={editions}
          regenerate={regenerateTokenAction}
          revoke={revokeTokenAction}
        />
      </AuthorShell>
    )
  })
}
