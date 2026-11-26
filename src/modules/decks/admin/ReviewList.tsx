'use client'

import { useState } from 'react'
import { ReviewActions } from './ReviewActions'

export interface ReviewRow {
  id: number
  name: string
  createdAt: string
  index: string
}

/**
 * The pending decks with their actions, and the panel's live region: it outlives the row of a
 * reviewed deck, which leaves the list when the dashboard refreshes.
 */
export function ReviewList({ decks }: { decks: readonly ReviewRow[] }) {
  const [message, setMessage] = useState('')
  return (
    <>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {decks.length === 0 ? (
        <p>Aucun deck en attente.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {decks.map((deck) => (
            <li
              key={deck.id}
              aria-label={deck.name}
              style={{
                padding: 'calc(var(--base) / 2) 0',
                borderTop: '1px solid var(--theme-elevation-100)',
              }}
            >
              <p style={{ margin: '0 0 calc(var(--base) / 4)' }}>
                <strong>{deck.name}</strong> — créé le {deck.createdAt} —{' '}
                <a href={`/admin/collections/decks/${String(deck.id)}`}>fiche</a> —{' '}
                <a href={deck.index}>index.json</a>
              </p>
              <ReviewActions id={deck.id} name={deck.name} onDone={setMessage} />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
