import type { Payload } from 'payload'
import { isAdminCollectionUser } from '@/core/payload/access'
import { pendingDecks, servePath } from '../server'
import { ReviewList } from './ReviewList'

const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Paris',
})

/**
 * Dashboard panel: the decks awaiting review, each with "Valider" and "Masquer" (reason required).
 * The actions call `POST /api/decks/:id/approve|hide`, which only a verified administrator passes.
 */
export async function PendingDecks({ payload, user }: { payload: Payload; user?: unknown }) {
  if (!isAdminCollectionUser(user)) return null
  const decks = await pendingDecks(payload)
  return (
    <section
      aria-labelledby="pending-decks-title"
      style={{
        margin: '0 0 calc(var(--base) * 2)',
        padding: 'var(--base)',
        border: '1px solid var(--theme-elevation-150)',
        borderRadius: 4,
      }}
    >
      <h2 id="pending-decks-title" style={{ marginTop: 0 }}>
        Decks en attente de validation
      </h2>
      <ReviewList
        decks={decks.map((deck) => ({
          id: deck.id,
          name: `${deck.handle}/${deck.deckId}`,
          createdAt: dateFormat.format(deck.createdAt),
          index: servePath(deck.handle, deck.deckId, 'index.json'),
        }))}
      />
    </section>
  )
}
