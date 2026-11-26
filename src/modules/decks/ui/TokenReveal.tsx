'use client'
import { useEffect, useId, useRef } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { TextField } from '@/core/ui/forms/TextField'
import { deckMessages } from '../messages'
import { CopyButton } from './CopyButton'

/**
 * A publish token, shown once right after the server made it. It lives only in this component's
 * state: never stored, logged or put in an address. "I have copied the token" removes it for good.
 */
export function TokenReveal({
  locale,
  token,
  onHide,
}: {
  locale: Locale
  token: string
  onHide: () => void
}) {
  const t = deckMessages[locale].token
  const id = useId()
  const warning = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    warning.current?.focus()
  }, [])
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-4 rounded-lg border border-border p-4"
    >
      <h3 id={`${id}-title`}>{t.newTitle}</h3>
      <p ref={warning} tabIndex={-1} className="font-semibold">
        {t.warning}
      </p>
      <TextField
        id={`${id}-token`}
        label={t.label}
        value={token}
        readOnly
        autoComplete="off"
        spellCheck={false}
        className="font-mono"
        onFocus={(event) => {
          event.currentTarget.select()
        }}
      />
      <CopyButton value={token} label={t.copy} copied={t.copied} failed={t.copyFailed} />
      <div>
        <Button type="button" onClick={onHide}>
          {t.hide}
        </Button>
      </div>
    </section>
  )
}
