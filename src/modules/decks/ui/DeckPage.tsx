import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { catalogueMessages } from '../catalogue-messages'
import { isSafeHref, markdownText } from '../domain/markdown'
import { cataloguePath, deckPagePath } from '../paths'
import { deckPage } from '../server'
import { CopyButton } from './CopyButton'
import { formatDate, formatDay, languageName } from './format'
import { Markdown } from './Markdown'
import { param, publicMetadata, publicPage } from './public-shell'
import { signedInCustomer, sitePayload } from './session'

interface Props {
  params: Promise<{ locale: string; handle: string; deck: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/** One request's deck page, shared by the metadata and the page. */
const load = cache(
  async (locale: string, handle: string, deckId: string, edition: string | undefined) => {
    const payload = await sitePayload()
    return deckPage(payload, {
      handle,
      deckId,
      edition,
      locale,
      // Read only for a pending deck, which only its author may see.
      viewer: () => signedInCustomer(payload),
    })
  },
)

const decode = (segment: string) => {
  try {
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}

export async function generateMetadata({ params, searchParams }: Props) {
  const { locale, handle, deck } = await params
  const edition = param((await searchParams)['edition'])
  return publicMetadata(locale, async (locale) => {
    const t = catalogueMessages[locale].deck
    const page = await load(locale, decode(handle), decode(deck), edition)
    if (page.kind !== 'found') return { title: t.missingTitle, indexable: false }
    const description = page.edition.description ? markdownText(page.edition.description) : ''
    return {
      title: page.edition.name || page.deckId,
      ...(description ? { description: description.slice(0, 160) } : {}),
      paths: {
        fr: deckPagePath('fr', page.handle, page.deckId),
        en: deckPagePath('en', page.handle, page.deckId),
      },
      // A pending deck is shown to its author only, never indexed.
      indexable: page.status === 'approved',
    }
  })
}

/**
 * A deck's public page: its author, licence, homepage, editions with their add-on addresses,
 * notes, latest version, description (safe Markdown), a preview of a few cards in sandboxed
 * iframes, and the version history. Pending: its author only (404 for anyone else). Hidden: the
 * not-found boundary of this segment says it was withdrawn.
 */
export default async function DeckPage({ params, searchParams }: Props) {
  const { locale, handle, deck } = await params
  const edition = param((await searchParams)['edition'])
  return publicPage(locale, async (locale) => {
    const page = await load(locale, decode(handle), decode(deck), edition)
    if (page.kind !== 'found') notFound()
    return <DeckView locale={locale} page={page} />
  })
}

type Found = Extract<Awaited<ReturnType<typeof deckPage>>, { kind: 'found' }>

function DeckView({ locale, page }: { locale: Locale; page: Found }) {
  const t = catalogueMessages[locale].deck
  const shown = page.edition
  const languages = shown.languages.map((code) => languageName(locale, code)).join(', ')
  const editionHref = (code: string) =>
    `${deckPagePath(locale, page.handle, page.deckId)}?edition=${encodeURIComponent(code)}`
  return (
    <main className="commerce-page flex flex-col gap-8">
      <p>
        <Link href={cataloguePath(locale)} className="text-link">
          {t.catalogue}
        </Link>
      </p>
      <div className="flex flex-col gap-2">
        <h1 className="break-words">{shown.name || page.deckId}</h1>
        <p className="text-muted-foreground break-all">
          {t.by} {page.handle}
        </p>
      </div>
      {page.status === 'pending' && (
        <p role="note" className="rounded-lg border border-border p-4">
          {t.pending}
        </p>
      )}

      <section aria-labelledby="deck-facts" className="flex flex-col gap-3">
        <h2 id="deck-facts">{t.facts}</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[max-content_1fr]">
          <dt className="font-semibold">{t.license}</dt>
          <dd className="break-words">{shown.license || t.none}</dd>
          <dt className="font-semibold">{t.homepage}</dt>
          <dd className="break-all">
            {shown.homepage && isSafeHref(shown.homepage) ? (
              <a href={shown.homepage} className="text-link" rel="nofollow ugc noopener noreferrer">
                {shown.homepage}
              </a>
            ) : (
              shown.homepage || t.none
            )}
          </dd>
          <dt className="font-semibold">{t.languages}</dt>
          <dd>{languages || t.none}</dd>
          <dt className="font-semibold">{t.notes}</dt>
          <dd>{shown.notes}</dd>
          <dt className="font-semibold">{t.lastVersion}</dt>
          <dd className="break-all">
            {formatDay(locale, shown.receivedAt)} ({shown.version})
          </dd>
        </dl>
      </section>

      {shown.description && (
        <section aria-labelledby="deck-description" className="flex flex-col gap-3 break-words">
          <h2 id="deck-description">{t.description}</h2>
          <Markdown source={shown.description} headingLevel={3} />
        </section>
      )}

      <section aria-labelledby="deck-editions" className="flex flex-col gap-4">
        <h2 id="deck-editions">{t.editionsTitle}</h2>
        <p>{t.editionsIntro}</p>
        <ul className="flex flex-col gap-6">
          {page.editions.map((edition) => (
            <li key={edition.code} className="flex flex-col gap-2">
              <h3 className="break-all">
                {edition.code === shown.code ? (
                  <span aria-current="true">
                    {edition.code} <span className="text-muted-foreground">({t.shown})</span>
                  </span>
                ) : (
                  <Link
                    href={editionHref(edition.code)}
                    className="text-link"
                    aria-label={t.show(edition.code)}
                  >
                    {edition.code}
                  </Link>
                )}
              </h3>
              <p className="sr-only">{t.address(edition.code)}</p>
              <p>
                <code className="break-all" data-testid={`address-${edition.code}`}>
                  {page.address(edition.code)}
                </code>
              </p>
              <CopyButton
                value={page.address(edition.code)}
                label={t.copy(edition.code)}
                copied={t.copied}
                failed={t.copyFailed}
              />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="deck-preview" className="flex flex-col gap-4">
        <h2 id="deck-preview">{t.previewTitle}</h2>
        {shown.previews > 0 ? (
          <>
            <p>{t.previewIntro}</p>
            <ol className="flex flex-col gap-6">
              {Array.from({ length: shown.previews }, (_, i) => (
                <li key={`${shown.code}-${shown.version}-${i}`} className="flex flex-col gap-2">
                  <h3>{t.card(i + 1)}</h3>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {(['front', 'back'] as const).map((side) => (
                      <figure key={side} className="flex min-w-0 flex-col gap-1">
                        <figcaption className="text-muted-foreground">
                          {side === 'front' ? t.front : t.back}
                        </figcaption>
                        {/* The author's card runs only in this sandbox: an opaque origin, no
                            access to the site or its cookies (preview-route.ts). */}
                        <iframe
                          src={page.preview(i, side)}
                          sandbox="allow-scripts"
                          title={t.frameTitle(i + 1, side === 'front' ? t.front : t.back)}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="h-56 w-full rounded-lg border border-border bg-white"
                        />
                      </figure>
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <p>{t.noPreview}</p>
        )}
      </section>

      <section aria-labelledby="deck-history" className="flex flex-col gap-4">
        <h2 id="deck-history">{t.historyTitle}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{t.historyCaption(shown.code)}</caption>
            <thead>
              <tr>
                <th scope="col">{t.receivedAt}</th>
                <th scope="col">{t.version}</th>
                <th scope="col">{t.notes}</th>
              </tr>
            </thead>
            <tbody>
              {shown.versions.map((version) => (
                <tr key={version.version}>
                  <td>{formatDate(locale, version.receivedAt)}</td>
                  <td className="break-all">{version.version}</td>
                  <td>{version.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
