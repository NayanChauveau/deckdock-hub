import Link from 'next/link'
import type { Locale } from '@/core/i18n/locales'
import type { DeckPageResult } from '../application/catalogue'
import { catalogueMessages } from '../catalogue-messages'
import { truncateDescription } from '../domain/markdown'
import { cataloguePath, deckPagePath } from '../paths'
import { CopyField } from './components/CopyField'
import { DeckIcon } from './components/DeckIcon'
import { Section } from './components/Section'
import { formatDate, languageAutonym, languageName, relativeTime } from './format'
import { Markdown } from './Markdown'
import { PreviewCarousel } from './PreviewCarousel'

/** The Anki add-on « DeckDock »: its page, until it has an AnkiWeb id. */
export const ADDON_URL = 'https://github.com/NayanChauveau/deckdock/tree/main/addon'

type Found = Extract<DeckPageResult, { kind: 'found' }>

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const tab = `inline-flex min-h-9 max-w-full items-center rounded-full border px-3.5 text-sm font-medium wrap-anywhere transition ${focus}`
const tabOn = `${tab} border-primary bg-primary text-primary-foreground`
const tabOff = `${tab} border-border bg-card text-foreground hover:text-brand`
const inlineLink = `font-medium text-brand underline-offset-2 hover:underline ${focus}`
// Links of the author's description: inline, not the site's editorial `.text-link`.
const prose =
  'flex flex-col gap-3 text-sm leading-relaxed wrap-anywhere [&_a]:inline [&_a]:border-0 [&_a]:p-0 [&_a]:text-sm [&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_h3]:font-semibold [&_h4]:font-semibold [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3'

/** The homepage, as « Source », only when it is an https URL (never http, javascript:…). */
function sourceURL(homepage: string | null): URL | null {
  if (!homepage) return null
  try {
    const url = new URL(homepage)
    return url.protocol === 'https:' && url.hostname ? url : null
  } catch {
    return null
  }
}

/**
 * A deck's public page from the use case result (spec 2026-11-26-refonte-ux, « Page d'un deck »):
 * breadcrumb, header (icon, name, author, licence, last update), then « Suivre ce deck dans Anki »
 * (a tab per edition, its address to copy, the add-on) and « En bref » in the side column, the
 * preview carousel, the description and the version history in the main one. On a phone the
 * side column comes first, right under the header. `now` dates the « mis à jour il y a … ».
 */
export function DeckView({ locale, page, now }: { locale: Locale; page: Found; now: Date }) {
  const t = catalogueMessages[locale].deck
  const shown = page.edition
  const name = shown.name || page.deckId
  const pagePath = deckPagePath(locale, page.handle, page.deckId)
  const updatedAt = new Date(
    Math.max(...page.editions.map((edition) => edition.receivedAt.getTime())),
  )
  const updated = t.updated(relativeTime(locale, updatedAt, now) ?? t.justNow)
  // A description is "short Markdown": a very long one is cut before it is parsed.
  const description = shown.description ? truncateDescription(shown.description) : null
  const languages = shown.languages.map((code) => languageName(locale, code)).join(', ')
  const source = sourceURL(shown.homepage)
  const count = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB')
  const notes = Array.from({ length: shown.previews }, (_, i) => ({
    front: page.preview(i, 'front'),
    back: page.preview(i, 'back'),
  }))

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-6 py-8 sm:py-12">
      <nav aria-label={t.breadcrumb}>
        <ol className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <li className="shrink-0">
            <Link href={cataloguePath(locale)} className={`hover:text-brand ${focus}`}>
              {t.catalogueCrumb}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="min-w-0 truncate text-foreground">
            {name}
          </li>
        </ol>
      </nav>

      <header className="flex min-w-0 items-center gap-4">
        <DeckIcon icon={page.icon} name={name} deckId={page.deckId} size="lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight wrap-anywhere sm:text-3xl">{name}</h1>
          <p className="text-sm wrap-anywhere text-muted-foreground">
            {t.by} <strong className="font-semibold text-foreground">{page.handle}</strong>
            {shown.license ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                <span>{shown.license}</span>
              </>
            ) : null}
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            <span>{updated}</span>
          </p>
        </div>
      </header>

      {page.status === 'pending' && (
        <p role="note" className="rounded-xl border border-border bg-muted p-4 text-sm">
          {t.pending}
        </p>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
        {/* First in the page (right under the header on a phone), drawn on the right on a wide
            screen. */}
        <div className="flex min-w-0 flex-col gap-6 lg:col-start-2 lg:row-start-1">
          <Section id="deck-follow" title={t.followTitle} className="border border-primary/40">
            <div className="flex flex-col gap-3">
              <nav aria-label={t.editionsTitle}>
                <ul className="flex flex-wrap gap-2">
                  {page.editions.map((edition) => (
                    <li key={edition.code} className="max-w-full">
                      <Link
                        href={`${pagePath}?edition=${encodeURIComponent(edition.code)}`}
                        aria-current={edition.code === shown.code ? 'page' : undefined}
                        className={edition.code === shown.code ? tabOn : tabOff}
                        scroll={false}
                      >
                        {languageAutonym(edition.code)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <CopyField
                key={shown.code}
                label={t.address(shown.code)}
                value={page.address(shown.code)}
                testId={`address-${shown.code}`}
                copy={t.copy}
                copied={t.copied}
                failed={t.copyFailed}
              />
              <p className="text-sm text-muted-foreground">{t.followHow}</p>
              <p className="text-sm">
                <a href={ADDON_URL} className={inlineLink}>
                  {t.installAddon} <span aria-hidden="true">→</span>
                </a>
              </p>
            </div>
          </Section>

          <Section id="deck-facts" title={t.facts}>
            <dl className="text-sm">
              {[
                [t.notes, count.format(shown.notes)],
                [t.languages, languages || t.none],
                [t.license, shown.license || t.none],
              ].map(([term, value]) => (
                <div
                  key={term}
                  className="flex justify-between gap-4 border-b border-border py-2 last:border-0"
                >
                  <dt className="shrink-0">{term}</dt>
                  <dd className="min-w-0 text-right wrap-anywhere text-muted-foreground">
                    {value}
                  </dd>
                </div>
              ))}
              {source ? (
                <div className="flex justify-between gap-4 py-2">
                  <dt className="shrink-0">{t.source}</dt>
                  <dd className="min-w-0 text-right wrap-anywhere">
                    <a
                      href={source.href}
                      className={inlineLink}
                      rel="nofollow ugc noopener noreferrer"
                    >
                      {source.hostname} <span aria-hidden="true">↗</span>
                    </a>
                  </dd>
                </div>
              ) : null}
            </dl>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1">
          <Section id="deck-preview" title={t.previewTitle}>
            {notes.length > 0 ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">{t.previewIntro}</p>
                <PreviewCarousel
                  key={`${shown.code}-${shown.version}`}
                  locale={locale}
                  notes={notes}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t.noPreview}</p>
            )}
          </Section>

          {description && (
            <Section id="deck-description" title={t.description}>
              <div className={prose}>
                <Markdown source={description.text} headingLevel={3} />
                {description.truncated && (
                  <p className="text-muted-foreground">… {t.descriptionTruncated}</p>
                )}
              </div>
            </Section>
          )}

          <Section id="deck-history" title={t.historyTitle}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{t.historyCaption(shown.code)}</caption>
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t.receivedAt}
                    </th>
                    <th scope="col" className="py-2 pr-4 font-medium">
                      {t.version}
                    </th>
                    <th scope="col" className="py-2 text-right font-medium">
                      {t.notes}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.versions.map((version) => (
                    <tr key={version.version} className="border-b border-border last:border-0">
                      <td className="py-2 pr-4">{formatDate(locale, version.receivedAt)}</td>
                      <td className="py-2 pr-4 font-mono text-xs break-all">{version.version}</td>
                      <td className="py-2 text-right">{count.format(version.notes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
