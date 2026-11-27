import { notFound } from 'next/navigation'
import { cache } from 'react'
import { catalogueMessages } from '../catalogue-messages'
import { markdownText } from '../domain/markdown'
import { deckPagePath } from '../paths'
import { deckPage } from '../server'
import { DeckView } from './DeckView'
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
 * A deck's public page (drawn by DeckView): its header, « Suivre ce deck dans Anki », « En bref »,
 * the preview carousel, the description and the version history. Pending: its author only (404
 * for anyone else). Hidden: the not-found boundary of this segment says it was withdrawn.
 */
export default async function DeckPage({ params, searchParams }: Props) {
  const { locale, handle, deck } = await params
  const edition = param((await searchParams)['edition'])
  return publicPage(locale, async (locale) => {
    const page = await load(locale, decode(handle), decode(deck), edition)
    if (page.kind !== 'found') notFound()
    return <DeckView locale={locale} page={page} now={new Date()} />
  })
}
