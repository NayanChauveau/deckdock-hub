'use client'
import { useId, useState, type SyntheticEvent } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { Notice } from '@/core/ui/feedback/Notice'
import { TextField } from '@/core/ui/forms/TextField'
import { deckMessages } from '../messages'
import type { ActionError, HandleResult } from './results'

const fieldErrors = ['invalid_handle', 'reserved_handle', 'handle_taken', 'handle_already_chosen']
type FieldError = 'invalid_handle' | 'reserved_handle' | 'handle_taken' | 'handle_already_chosen'
const isFieldError = (error: ActionError): error is FieldError => fieldErrors.includes(error)

/**
 * Chooses the author's public handle, once. The server validates it (the page refreshes on
 * success); its refusals are shown under the field.
 */
export function HandleForm({
  locale,
  choose,
}: {
  locale: Locale
  choose: (handle: string) => Promise<HandleResult>
}) {
  const messages = deckMessages[locale]
  const t = messages.space
  const id = useId()
  const [handle, setHandle] = useState('')
  const [fieldError, setFieldError] = useState<FieldError | null>(null)
  const [failure, setFailure] = useState<'signed_out' | 'error' | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    setFailure(null)
    if (!handle.trim()) {
      setFieldError('invalid_handle')
      return
    }
    setBusy(true)
    try {
      const result = await choose(handle)
      if (result.ok) setFieldError(null)
      else if (isFieldError(result.error)) setFieldError(result.error)
      else setFailure(result.error === 'signed_out' ? 'signed_out' : 'error')
    } catch {
      setFailure('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="flex flex-col gap-6" noValidate onSubmit={(event) => void submit(event)}>
      <TextField
        id={`${id}-handle`}
        name="handle"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        required
        minLength={3}
        maxLength={30}
        label={t.handleLabel}
        description={t.handleHint}
        value={handle}
        {...(fieldError ? { error: t.handleErrors[fieldError] } : {})}
        onChange={(event) => {
          setHandle(event.target.value)
        }}
      />
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? messages.common.busy : t.handleSubmit}
        </Button>
      </div>
      {failure && (
        <Notice tone="error">
          {failure === 'signed_out' ? messages.common.signedOut : messages.common.error}
        </Notice>
      )}
    </form>
  )
}
