import Link from 'next/link'
import { redirect } from 'next/navigation'
import { accountPath, signInPath } from '@/modules/accounts/paths'
import { deckMessages } from '../messages'
import { authorDeckPath } from '../paths'
import { authorSpace } from '../server'
import { chooseHandleAction, createDeckAction } from './actions'
import { HandleForm } from './HandleForm'
import { NewDeckForm } from './NewDeckForm'
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
    const messages = deckMessages[locale]
    const t = messages.space
    return (
      <div className="commerce-page flex flex-col gap-8">
        <p>
          <Link href={accountPath(locale)} className="text-link">
            {t.account}
          </Link>
        </p>
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
        {author ? (
          <>
            <p>
              {t.handleIs} <strong className="break-all">{author.handle}</strong>
            </p>
            <section aria-labelledby="decks-list" className="flex flex-col gap-4">
              <h2 id="decks-list">{t.decksTitle}</h2>
              {decks.length ? (
                <ul className="flex flex-col gap-2">
                  {decks.map((deck) => (
                    <li key={deck.id} className="flex flex-wrap items-baseline gap-x-3">
                      <Link
                        href={authorDeckPath(locale, deck.deckId)}
                        className="text-link break-all"
                      >
                        {deck.deckId}
                      </Link>
                      <span className="text-muted-foreground">{messages.status[deck.status]}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t.noDecks}</p>
              )}
            </section>
            <section aria-labelledby="decks-new" className="flex flex-col gap-4">
              <h2 id="decks-new">{t.newTitle}</h2>
              <p>{t.newIntro}</p>
              <NewDeckForm locale={locale} create={createDeckAction} />
            </section>
          </>
        ) : (
          <section aria-labelledby="decks-handle" className="flex flex-col gap-4">
            <h2 id="decks-handle">{t.handleTitle}</h2>
            <p>{t.handleIntro}</p>
            <HandleForm locale={locale} choose={chooseHandleAction} />
          </section>
        )}
      </div>
    )
  })
}
