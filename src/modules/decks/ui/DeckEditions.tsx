import type { Locale } from '@/core/i18n/locales'
import type { EditionHistory } from '../domain/model'
import { editionAddress, servePath } from '../domain/serving'
import { deckMessages } from '../messages'
import { CopyButton } from './CopyButton'
import { formatDate } from './format'

/**
 * A deck's editions, each with its test address (to paste into the add-on) and its received
 * versions. Before the first version, the address pattern, with `<edition>` left as written.
 */
export function DeckEditions({
  locale,
  origin,
  handle,
  deckId,
  editions,
}: {
  locale: Locale
  origin: string
  handle: string
  deckId: string
  editions: readonly EditionHistory[]
}) {
  const messages = deckMessages[locale]
  const t = messages.deck
  const address = (edition: string) => editionAddress(origin, handle, deckId, edition)
  const addressPattern = `${origin.replace(/\/+$/, '')}${servePath(handle, deckId)}/<edition>/`
  return (
    <section
      aria-labelledby="deck-editions"
      className="flex min-w-0 flex-col gap-4 rounded-[var(--radius)] bg-card p-5 text-sm text-card-foreground shadow-[var(--shadow-card)]"
    >
      <h2 id="deck-editions" className="text-base font-semibold">
        {t.editionsTitle}
      </h2>
      {editions.length ? (
        editions.map((edition) => (
          <div
            key={edition.code}
            className="flex min-w-0 flex-col gap-3 border-t border-border pt-4 first-of-type:border-t-0 first-of-type:pt-0"
          >
            <h3 className="font-semibold wrap-anywhere">{edition.code}</h3>
            <p className="text-muted-foreground">{t.testAddress}</p>
            <p>
              <code className="font-mono break-all">{address(edition.code)}</code>
            </p>
            <CopyButton
              value={address(edition.code)}
              label={t.copyAddress}
              copied={messages.token.copied}
              failed={messages.token.copyFailed}
            />
            <div className="overflow-x-auto">
              <table className="w-full text-left [&_td]:py-1.5 [&_td]:pr-4 [&_th]:pb-1.5 [&_th]:pr-4 [&_th]:font-medium [&_th]:text-muted-foreground">
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
          <p className="text-muted-foreground">{t.noEditions}</p>
          <p className="text-muted-foreground">{t.testAddressPattern}</p>
          <p>
            <code className="font-mono break-all">{addressPattern}</code>
          </p>
        </>
      )}
    </section>
  )
}
