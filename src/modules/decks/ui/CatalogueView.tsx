import { SearchIcon } from 'lucide-react'
import Link from 'next/link'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { Input } from '@/core/ui/input'
import { Label } from '@/core/ui/label'
import { NativeSelect, NativeSelectOption } from '@/core/ui/native-select'
import { CATALOGUE_SORTS, type CataloguePage, type CatalogueSort } from '../application/catalogue'
import { catalogueMessages } from '../catalogue-messages'
import { authorSpacePath, cataloguePath } from '../paths'
import { CatalogueDeckCard } from './components/CatalogueDeckCard'
import { languageAutonym } from './format'

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const pill = `inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold transition ${focus}`
const primary = `${pill} bg-primary text-primary-foreground shadow-[var(--shadow-card)] hover:brightness-110`
const ghost = `${pill} border border-border bg-card text-foreground hover:text-brand`
const chip = `inline-flex min-h-9 items-center rounded-full border px-3.5 text-sm font-medium transition ${focus}`
const chipOn = `${chip} border-primary bg-primary text-primary-foreground`
const chipOff = `${chip} border-border bg-card text-foreground hover:text-brand`
const panel =
  'flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-border bg-card px-6 py-10 text-center'

/**
 * The catalogue's page from a use case result (spec 2026-11-26-refonte-ux, « Catalogue »): a big
 * search, language pills, the sort, a grid of deck cards, pagination and the empty states. Plain
 * links and a GET form: everything works without JavaScript. `now` dates the cards' « il y a … ».
 */
export function CatalogueView({
  locale,
  result,
  now,
}: {
  locale: Locale
  result: CataloguePage
  now: Date
}) {
  const t = catalogueMessages[locale].catalogue
  const href = (over: { language?: string; page?: number }) => {
    const search = new URLSearchParams()
    const language = over.language ?? result.language
    if (result.query) search.set('q', result.query)
    if (language) search.set('lang', language)
    if (result.sort !== 'updated') search.set('sort', result.sort)
    if (over.page && over.page > 1) search.set('page', String(over.page))
    const text = search.toString()
    return text ? `${cataloguePath(locale)}?${text}` : cataloguePath(locale)
  }
  const searching = Boolean(result.query || result.language)
  const emptyCatalogue = result.total === 0 && !searching
  const beyond = result.total > 0 && result.decks.length === 0

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-6 py-10 sm:py-14">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{t.title}</h1>
        <p className="max-w-2xl text-muted-foreground">{t.intro}</p>
      </header>

      <form
        role="search"
        action={cataloguePath(locale)}
        method="get"
        className="flex flex-col gap-4"
      >
        <div className="flex flex-col gap-2">
          <Label htmlFor="catalogue-q" className="sr-only">
            {t.searchLabel}
          </Label>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="catalogue-q"
                name="q"
                type="search"
                defaultValue={result.query}
                maxLength={100}
                placeholder={t.searchPlaceholder}
                aria-describedby="catalogue-q-hint"
                className="h-13 rounded-xl bg-card pr-4 pl-12 text-base shadow-[var(--shadow-card)] md:text-base dark:bg-card"
              />
            </div>
            {result.language ? <Input type="hidden" name="lang" value={result.language} /> : null}
            <Button type="submit" className="h-13 rounded-full px-6 font-semibold">
              {t.submit}
            </Button>
          </div>
          <p id="catalogue-q-hint" className="text-sm text-muted-foreground">
            {t.searchHint}
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          {result.languages.length > 0 ? (
            <nav aria-label={t.languageFilter} className="min-w-0">
              <ul className="flex flex-wrap gap-2">
                <li>
                  <Link
                    href={href({ language: '', page: 1 })}
                    aria-current={result.language ? undefined : 'page'}
                    className={result.language ? chipOff : chipOn}
                  >
                    {t.anyLanguage}
                  </Link>
                </li>
                {result.languages.map((code) => {
                  const active = result.language === code
                  return (
                    <li key={code}>
                      <Link
                        href={href({ language: code, page: 1 })}
                        lang={code}
                        aria-current={active ? 'page' : undefined}
                        className={active ? chipOn : chipOff}
                      >
                        {languageAutonym(code)}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </nav>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Label htmlFor="catalogue-sort" className="font-normal text-muted-foreground">
              {t.sortLabel}
            </Label>
            <NativeSelect
              id="catalogue-sort"
              name="sort"
              defaultValue={result.sort}
              className="[&_select]:rounded-full [&_select]:bg-card"
            >
              {CATALOGUE_SORTS.map((sort: CatalogueSort) => (
                <NativeSelectOption key={sort} value={sort}>
                  {t.sorts[sort]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        </div>
      </form>

      <section aria-labelledby="catalogue-results" className="flex flex-col gap-5">
        {emptyCatalogue ? null : (
          <h2
            id="catalogue-results"
            data-testid="catalogue-total"
            className="text-base font-semibold"
          >
            {t.results(result.total)}
          </h2>
        )}

        {emptyCatalogue ? (
          <div className={panel}>
            <h2
              id="catalogue-results"
              data-testid="catalogue-total"
              className="text-lg font-semibold"
            >
              {t.emptyCatalogue}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">{t.emptyCatalogueText}</p>
            <Link href={authorSpacePath(locale)} className={`${primary} mt-2`}>
              {t.publishFirst}
            </Link>
          </div>
        ) : result.total === 0 ? (
          <div className={panel}>
            <p className="max-w-md text-muted-foreground">{t.noResultText}</p>
            <Link href={cataloguePath(locale)} className={`${ghost} mt-2`}>
              {t.clear}
            </Link>
          </div>
        ) : beyond ? (
          <div className={panel}>
            <p className="max-w-md text-muted-foreground">{t.beyondText(result.pageCount)}</p>
            <Link href={href({ page: 1 })} className={`${ghost} mt-2`}>
              {t.firstPage}
            </Link>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {result.decks.map((deck) => (
              <li key={`${deck.handle}/${deck.deckId}`} className="grid min-w-0">
                <CatalogueDeckCard locale={locale} deck={deck} now={now} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {result.decks.length > 0 && result.pageCount > 1 ? (
        <nav aria-label={t.pagination} className="flex flex-wrap items-center justify-center gap-3">
          {result.page > 1 ? (
            <Link href={href({ page: result.page - 1 })} className={ghost} rel="prev">
              <span aria-hidden="true">←</span>
              {t.previous}
            </Link>
          ) : null}
          <span className="px-2 text-sm text-muted-foreground">
            {t.pageOf(result.page, result.pageCount)}
          </span>
          {result.page < result.pageCount ? (
            <Link href={href({ page: result.page + 1 })} className={ghost} rel="next">
              {t.next}
              <span aria-hidden="true">→</span>
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  )
}
