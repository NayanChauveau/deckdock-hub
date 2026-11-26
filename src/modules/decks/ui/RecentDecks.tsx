import type { ReactNode } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { recentDecks } from '../server'
import { CatalogueDeckCard } from './components/CatalogueDeckCard'
import { sitePayload } from './session'

/** At most this many recent decks on the homepage. */
const MOST = 6
/** How many recent decks to show out of `available`: six, or full rows of up to three. */
export const recentCount = (available: number) =>
  available >= MOST ? MOST : Math.min(available, 3)

/**
 * The most recently updated approved decks (at most six, newest first), as cards in
 * the visitor's language; `empty` when no deck is approved yet.
 * Cards are the catalogue's (languages, notes, relative time, author).
 */
export async function RecentDecks({ locale, empty }: { locale: Locale; empty: ReactNode }) {
  const decks = await recentDecks(await sitePayload(), { locale, limit: MOST })
  const now = new Date()
  const shown = decks.slice(0, recentCount(decks.length))
  if (shown.length === 0) return empty
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map((deck) => (
        <li key={`${deck.handle}/${deck.deckId}`} className="grid min-w-0">
          <CatalogueDeckCard locale={locale} deck={deck} now={now} />
        </li>
      ))}
    </ul>
  )
}
