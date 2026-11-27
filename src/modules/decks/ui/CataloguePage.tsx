import { catalogueMessages } from '../catalogue-messages'
import { cataloguePath } from '../paths'
import { catalogue } from '../server'
import { CatalogueView } from './CatalogueView'
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

/**
 * The public catalogue: approved decks, searched in their name and description (no case, no
 * accents), filtered by language and sorted, 20 per page (drawn by CatalogueView).
 */
export default async function CataloguePage({ params, searchParams }: Props) {
  const { locale } = await params
  return publicPage(locale, async (locale) => {
    const query = await searchParams
    const result = await catalogue(await sitePayload(), {
      q: param(query['q']),
      lang: param(query['lang']),
      page: param(query['page']),
      sort: param(query['sort']),
      locale,
    })
    return <CatalogueView locale={locale} result={result} now={new Date()} />
  })
}
