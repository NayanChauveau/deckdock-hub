import type { Locale } from '@/core/i18n/locales'
import type { CatalogueCard } from '../../application/catalogue'
import { catalogueMessages } from '../../catalogue-messages'
import { markdownText } from '../../domain/markdown'
import { relativeTime } from '../format'
import { DeckCard } from './DeckCard'

/** At most this many characters of a description on a card (it shows two lines). */
const SUMMARY = 220
const summary = (description: string | null) => {
  const text = description ? markdownText(description) : ''
  return text.length > SUMMARY ? `${text.slice(0, SUMMARY - 1).trimEnd()}…` : text
}

/**
 * A catalogue deck as a card, the same on the catalogue and on the homepage: languages, « N notes »,
 * the last update relative to the server's `now` (« il y a 2 j »), and the author's handle.
 */
export function CatalogueDeckCard({
  locale,
  deck,
  now,
}: {
  locale: Locale
  deck: CatalogueCard
  now: Date
}) {
  const t = catalogueMessages[locale].catalogue
  return (
    <DeckCard
      href={deck.href}
      deckId={deck.deckId}
      name={deck.name}
      description={summary(deck.description) || null}
      icon={deck.icon}
      languages={deck.languages}
      pills={[t.notes(deck.notes), relativeTime(locale, deck.updatedAt, now) ?? t.justNow]}
      meta={`${t.by} ${deck.handle}`}
    />
  )
}
