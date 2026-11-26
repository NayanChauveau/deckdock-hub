'use client'

import { Button, useConfig } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'

/** "Valider" and "Masquer" (with its reason) for one pending deck of the dashboard panel. */
export function ReviewActions({
  id,
  name,
  onDone,
}: {
  id: number
  name: string
  /** What happened, said by the panel (this row disappears once the deck is reviewed). */
  onDone: (message: string) => void
}) {
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const router = useRouter()
  const reasonId = useId()
  const [hiding, setHiding] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const required = useId()

  async function act(action: 'approve' | 'hide') {
    setPending(true)
    setMessage('')
    try {
      const response = await fetch(`${serverURL}${api}/decks/${String(id)}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'hide' ? { reason } : {}),
      })
      const body: unknown = await response.json().catch(() => ({}))
      if (!response.ok) {
        const text: unknown = Reflect.get(Object(body), 'message')
        setMessage(typeof text === 'string' ? text : 'Action impossible pour le moment.')
        return
      }
      onDone(action === 'approve' ? `${name} est publié.` : `${name} est masqué.`)
      router.refresh()
    } catch {
      setMessage('Action impossible pour le moment.')
    } finally {
      setPending(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 'calc(var(--base) / 2)', flexWrap: 'wrap' }}>
        <Button
          type="button"
          buttonStyle="primary"
          margin={false}
          disabled={pending}
          aria-label={`Valider ${name}`}
          onClick={() => void act('approve')}
        >
          Valider
        </Button>
        {!hiding && (
          <Button
            type="button"
            buttonStyle="secondary"
            margin={false}
            disabled={pending}
            aria-label={`Masquer ${name}`}
            onClick={() => {
              setHiding(true)
            }}
          >
            Masquer
          </Button>
        )}
      </div>
      {hiding && (
        <div className="field-type" style={{ marginTop: 'calc(var(--base) / 2)' }}>
          <label htmlFor={reasonId} className="field-label">
            Raison du masquage
          </label>
          <p id={required}>Obligatoire. Visible par l’auteur du deck.</p>
          <textarea
            id={reasonId}
            required
            aria-required="true"
            aria-describedby={required}
            value={reason}
            rows={2}
            onChange={(event) => {
              setReason(event.target.value)
            }}
          />
          <div style={{ display: 'flex', gap: 'calc(var(--base) / 2)', flexWrap: 'wrap' }}>
            <Button
              type="button"
              buttonStyle="primary"
              margin={false}
              disabled={pending || !reason.trim()}
              onClick={() => void act('hide')}
            >
              Confirmer le masquage
            </Button>
            <Button
              type="button"
              buttonStyle="secondary"
              margin={false}
              disabled={pending}
              onClick={() => {
                setHiding(false)
              }}
            >
              Annuler
            </Button>
          </div>
        </div>
      )}
      {message && <p role="alert">{message}</p>}
    </div>
  )
}
