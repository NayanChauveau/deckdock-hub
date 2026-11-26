import Link from 'next/link'
import { Button } from '@/core/ui/button'
import { Field, FieldLabel } from '@/core/ui/field'
import { TextField } from '@/core/ui/forms/TextField'
import { NativeSelect, NativeSelectOption } from '@/core/ui/native-select'
import { catalogueMessages } from '../catalogue-messages'
import { markdownText } from '../domain/markdown'
import { cataloguePath } from '../paths'
import { catalogue } from '../server'
import { formatDay, languageName } from './format'
import { param, publicMetadata, publicPage } from './public-shell'
import { sitePayload } from './session'

interface Props {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Pick<Props, 'params'>) {
  const { locale } = await params
  return publicMetadata(locale, (locale) => {
    const t = catalogueMessages[locale].catalogue
    return {
      title: t.title,
      description: t.description,
      paths: { fr: cataloguePath('fr'), en: cataloguePath('en') },
      indexable: true,
    }
  })
}

/** At most this many characters of a description in the list. */
const SUMMARY = 220
const summary = (description: string | null) => {
  const text = description ? markdownText(description) : ''
  return text.length > SUMMARY ? `${text.slice(0, SUMMARY - 1).trimEnd()}…` : text
}

/**
 * The public catalogue: approved decks, searched in their name and description (no case, no
 * accents) and filtered by language, 20 per page. A plain GET form: it works without JavaScript.
 */
export default async function CataloguePage({ params, searchParams }: Props) {
  const { locale } = await params
  return publicPage(locale, async (locale) => {
    const query = await searchParams
    const result = await catalogue(await sitePayload(), {
      q: param(query['q']),
      lang: param(query['lang']),
      page: param(query['page']),
      locale,
    })
    const t = catalogueMessages[locale].catalogue
    const pageHref = (page: number) => {
      const search = new URLSearchParams()
      if (result.query) search.set('q', result.query)
      if (result.language) search.set('lang', result.language)
      if (page > 1) search.set('page', String(page))
      const text = search.toString()
      return text ? `${cataloguePath(locale)}?${text}` : cataloguePath(locale)
    }
    return (
      <main className="commerce-page flex flex-col gap-8">
        <h1>{t.title}</h1>
        <p>{t.intro}</p>
        <form
          role="search"
          action={cataloguePath(locale)}
          method="get"
          className="flex flex-wrap items-end gap-4"
        >
          <TextField
            id="catalogue-q"
            name="q"
            type="search"
            label={t.searchLabel}
            description={t.searchHint}
            defaultValue={result.query}
            maxLength={100}
            fieldClassName="min-w-0 flex-1 basis-64"
          />
          <Field className="w-auto">
            <FieldLabel htmlFor="catalogue-lang">{t.languageLabel}</FieldLabel>
            <NativeSelect id="catalogue-lang" name="lang" defaultValue={result.language}>
              <NativeSelectOption value="">{t.anyLanguage}</NativeSelectOption>
              {result.languages.map((code) => (
                <NativeSelectOption key={code} value={code}>
                  {languageName(locale, code)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Button type="submit" size="lg">
            {t.submit}
          </Button>
        </form>

        <section aria-labelledby="catalogue-results" className="flex flex-col gap-6">
          <h2 id="catalogue-results" data-testid="catalogue-total">
            {t.results(result.total)}
          </h2>
          {result.decks.length > 0 && (
            <ul className="flex flex-col gap-6">
              {result.decks.map((deck) => (
                <li
                  key={`${deck.handle}/${deck.deckId}`}
                  className="flex flex-col gap-2 border-b border-border pb-6"
                >
                  <h3 className="break-words">
                    <Link href={deck.href} className="text-link">
                      {deck.name}
                    </Link>
                  </h3>
                  <p className="text-muted-foreground break-all">
                    {t.by} {deck.handle}
                  </p>
                  {deck.description && <p className="break-words">{summary(deck.description)}</p>}
                  <p className="text-muted-foreground">
                    {t.languages(
                      deck.languages.map((code) => languageName(locale, code)).join(', '),
                    )}
                    {' · '}
                    <span className="break-all">{t.editions(deck.editions.join(', '))}</span>
                    {' · '}
                    {t.updated(formatDay(locale, deck.updatedAt))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

        {result.pageCount > 1 && (
          <nav aria-label={t.pagination} className="flex flex-wrap items-center gap-4">
            {result.page > 1 && (
              <Link href={pageHref(result.page - 1)} className="text-link" rel="prev">
                {t.previous}
              </Link>
            )}
            <span>{t.pageOf(Math.min(result.page, result.pageCount), result.pageCount)}</span>
            {result.page < result.pageCount && (
              <Link href={pageHref(result.page + 1)} className="text-link" rel="next">
                {t.next}
              </Link>
            )}
          </nav>
        )}
      </main>
    )
  })
}
