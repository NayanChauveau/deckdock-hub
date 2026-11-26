import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { signInPath } from '@/modules/accounts/paths'
import { deckMessages } from '../messages'
import { authorSpacePath } from '../paths'
import { authorDeck, DecksError, editionAddress } from '../server'
import { regenerateTokenAction, revokeTokenAction } from './actions'
import { CopyButton } from './CopyButton'
import { accountPage, authorMetadata, formatDate } from './page-shell'
import { signedInCustomer, sitePayload } from './session'
import { TokenPanel } from './TokenPanel'

export const generateMetadata = authorMetadata((locale) => deckMessages[locale].space.title)

interface Props {
  params: Promise<{ locale: string; deckId: string }>
}

/**
 * One deck of the author: its status, its editions and received versions with their test address,
 * its token (regenerate, revoke) and the CI settings. Another author's deck is a 404.
 */
export default async function AuthorDeckPage(props: Props) {
  return accountPage(props, async (locale) => {
    const payload = await sitePayload()
    const customerId = await signedInCustomer(payload)
    if (customerId === null) redirect(signInPath(locale))
    const { deckId } = await props.params
    const view = await authorDeck(payload, customerId, deckId).catch((error: unknown) => {
      if (error instanceof DecksError && error.code === 'not_found') notFound()
      throw error
    })
    const { author, deck, editions } = view
    const origin = payload.config.serverURL
    const messages = deckMessages[locale]
    const t = messages.deck
    const address = (edition: string) => editionAddress(origin, author.handle, deck.deckId, edition)
    return (
      <main className="commerce-page flex flex-col gap-8">
        <p>
          <Link href={authorSpacePath(locale)} className="text-link">
            {t.back}
          </Link>
        </p>
        <h1 className="break-all">{deck.deckId}</h1>

        <section aria-labelledby="deck-status" className="flex flex-col gap-3">
          <h2 id="deck-status">{t.statusTitle}</h2>
          <p>
            <strong data-testid="deck-status">{messages.status[deck.status]}</strong>
          </p>
          <p>{t.statusHelp[deck.status]}</p>
          {deck.status === 'hidden' && deck.hiddenReason && (
            <p>
              {t.hiddenReason} {deck.hiddenReason}
            </p>
          )}
        </section>

        <section aria-labelledby="deck-editions" className="flex flex-col gap-4">
          <h2 id="deck-editions">{t.editionsTitle}</h2>
          {editions.length ? (
            editions.map((edition) => (
              <div key={edition.code} className="flex flex-col gap-3">
                <h3>{edition.code}</h3>
                <p>{t.testAddress}</p>
                <p>
                  <code className="break-all">{address(edition.code)}</code>
                </p>
                <CopyButton
                  value={address(edition.code)}
                  label={t.copyAddress}
                  copied={messages.token.copied}
                  failed={messages.token.copyFailed}
                />
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <caption className="sr-only">{t.versionsCaption(edition.code)}</caption>
                    <thead>
                      <tr>
                        <th scope="col">{t.receivedAt}</th>
                        <th scope="col">{t.version}</th>
                        <th scope="col">{t.notes}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {edition.versions.map((version) => (
                        <tr key={version.version}>
                          <td>{formatDate(locale, version.receivedAt)}</td>
                          <td className="break-all">{version.version}</td>
                          <td>{version.notes}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          ) : (
            <>
              <p>{t.noEditions}</p>
              <p>{t.testAddressPattern}</p>
              <p>
                <code className="break-all">{address('<edition>')}</code>
              </p>
            </>
          )}
        </section>

        <section aria-labelledby="deck-token" className="flex flex-col gap-4">
          <h2 id="deck-token">{messages.token.title}</h2>
          <p>{messages.token.intro}</p>
          <p>
            {deck.tokenLastUsedAt
              ? t.lastUsed(formatDate(locale, deck.tokenLastUsedAt))
              : t.neverUsed}
          </p>
          <TokenPanel
            locale={locale}
            deckId={deck.deckId}
            regenerate={regenerateTokenAction}
            revoke={revokeTokenAction}
          />
        </section>

        <section aria-labelledby="deck-ci" className="flex flex-col gap-4">
          <h2 id="deck-ci">{t.ciTitle}</h2>
          <p>{t.ciIntro}</p>
          <dl>
            <div>
              <dt>
                {t.ciSecret} <code>DECKDOCK_TOKEN</code>
              </dt>
              <dd>{t.ciSecretValue}</dd>
            </div>
            <div>
              <dt>
                {t.ciVariable} <code>DECKDOCK_HUB_URL</code>
              </dt>
              <dd>
                <code className="break-all">{origin}</code>
              </dd>
            </div>
          </dl>
          <p>{t.ciOutro}</p>
        </section>
      </main>
    )
  })
}
