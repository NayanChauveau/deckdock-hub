import type { Payload } from 'payload'
import { isAdminCollectionUser } from '@/core/payload/access'
import { pendingDecks, servePath } from '../server'
import { ReviewActions } from './ReviewActions'

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
      {decks.length === 0 ? (
        <p>Aucun deck en attente.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {decks.map((deck) => (
            <li
              key={deck.id}
              aria-label={`${deck.handle}/${deck.deckId}`}
              style={{
                padding: 'calc(var(--base) / 2) 0',
                borderTop: '1px solid var(--theme-elevation-100)',
              }}
            >
              <p style={{ margin: '0 0 calc(var(--base) / 4)' }}>
                <strong>
                  {deck.handle}/{deck.deckId}
                </strong>{' '}
                — créé le {dateFormat.format(deck.createdAt)} —{' '}
                <a href={`/admin/collections/decks/${String(deck.id)}`}>fiche</a> —{' '}
                <a href={servePath(deck.handle, deck.deckId, 'index.json')}>index.json</a>
              </p>
              <ReviewActions id={deck.id} name={`${deck.handle}/${deck.deckId}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
