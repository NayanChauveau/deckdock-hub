'use client'
import Link from 'next/link'
import { useId, useState, type SyntheticEvent } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { Notice } from '@/core/ui/feedback/Notice'
import { TextField } from '@/core/ui/forms/TextField'
import { deckMessages, failureText } from '../messages'
import { authorDeckPath } from '../paths'
import { failureOf, type ActionError, type CreateDeckResult, type Failure } from './results'
import { TokenReveal } from './TokenReveal'

type FieldError = 'invalid_deck_id' | 'deck_exists' | 'deck_limit' | 'no_handle'
const isFieldError = (error: ActionError): error is FieldError =>
  error === 'invalid_deck_id' ||
  error === 'deck_exists' ||
  error === 'deck_limit' ||
  error === 'no_handle'

/** Creates a deck from its `deck.id`, then shows its first token once. */
export function NewDeckForm({
  locale,
  create,
}: {
  locale: Locale
  create: (deckId: string) => Promise<CreateDeckResult>
}) {
  const messages = deckMessages[locale]
  const t = messages.space
  const id = useId()
  const [deckId, setDeckId] = useState('')
  const [fieldError, setFieldError] = useState<FieldError | null>(null)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    setFailure(null)
    if (!deckId.trim()) {
      setFieldError('invalid_deck_id')
      return
    }
    setBusy(true)
    try {
      const result = await create(deckId.trim())
      if (result.ok) {
        setFieldError(null)
        setDeckId('')
        setCreated(result.deckId)
        setToken(result.token)
      } else if (isFieldError(result.error)) setFieldError(result.error)
      else setFailure(failureOf(result.error))
    } catch {
      setFailure('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form className="flex flex-col gap-6" noValidate onSubmit={(event) => void submit(event)}>
        <TextField
          id={`${id}-deck`}
          name="deckId"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          maxLength={100}
          label={t.deckIdLabel}
          description={t.deckIdHint}
          value={deckId}
          {...(fieldError ? { error: t.createErrors[fieldError] } : {})}
          onChange={(event) => {
            setDeckId(event.target.value)
          }}
        />
        <div>
          <Button type="submit" disabled={busy}>
            {busy ? messages.common.busy : t.newSubmit}
          </Button>
        </div>
        {failure && <Notice tone="error">{failureText(messages, failure)}</Notice>}
      </form>
      {created && (
        <div className="flex flex-col gap-4">
          <Notice>{t.created(created)}</Notice>
          {token && (
            <TokenReveal
              locale={locale}
              token={token}
              onHide={() => {
                setToken(null)
              }}
            />
          )}
          <p>
            <Link href={authorDeckPath(locale, created)} className="text-link">
              {t.openDeck}
            </Link>
          </p>
        </div>
      )}
    </div>
  )
}
