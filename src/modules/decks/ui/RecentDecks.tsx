import type { ReactNode } from 'react'
import { markdownText } from '../domain/markdown'
import { recentDecks } from '../server'
import { DeckCard } from './components/DeckCard'
import { sitePayload } from './session'

/** At most this many recent decks on the homepage. */
const MOST = 6
/** How many recent decks to show out of `available`: six, or full rows of up to three. */
export const recentCount = (available: number) =>
  available >= MOST ? MOST : Math.min(available, 3)

/**
 * The most recently updated approved decks (at most six, newest first), as cards in
 * the visitor's language; `empty` when no deck is approved yet. `by` introduces the author's handle.
 * Texts come from the page that shows it (a module does not import the site layer).
 */
export async function RecentDecks({
  locale,
  by,
  empty,
}: {
  locale: string
  by: string
  empty: ReactNode
}) {
  const decks = await recentDecks(await sitePayload(), { locale, limit: MOST })
  const shown = decks.slice(0, recentCount(decks.length))
  if (shown.length === 0) return empty
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {shown.map((deck) => (
        <li key={`${deck.handle}/${deck.deckId}`} className="grid min-w-0">
          <DeckCard
            href={deck.href}
            deckId={deck.deckId}
            name={deck.name}
            description={deck.description ? markdownText(deck.description) : null}
            icon={deck.icon}
            languages={deck.languages}
            meta={`${by} ${deck.handle}`}
          />
        </li>
      ))}
    </ul>
  )
}
