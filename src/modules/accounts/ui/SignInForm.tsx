'use client'
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { Notice } from '@/core/ui/feedback/Notice'
import { TextField } from '@/core/ui/forms/TextField'
import { accountMessages } from '../messages'
import { accountPath } from '../paths'

type Outcome = 'sent' | 'tooMany' | 'error' | null

/**
 * Asks Better Auth for a magic link. The answer is the same whether or not the address has an
 * account, and so is the message shown: once sent, the form gives way to « check your inbox »
 * (focus moves there), with a way back to the form for another address.
 */
export function SignInForm({ locale }: { locale: Locale }) {
  const t = accountMessages[locale].signIn
  const id = useId()
  const [email, setEmail] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const sentHeading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    if (outcome === 'sent') sentHeading.current?.focus()
  }, [outcome])

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const address = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setBusy(true)
    setOutcome(null)
    try {
      const response = await fetch('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: address, callbackURL: accountPath(locale) }),
      })
      setOutcome(response.ok ? 'sent' : response.status === 429 ? 'tooMany' : 'error')
    } catch {
      setOutcome('error')
    } finally {
      setBusy(false)
    }
  }

  if (outcome === 'sent')
    return (
      <div className="flex flex-col gap-4">
        <h2 ref={sentHeading} tabIndex={-1} className="text-lg font-semibold outline-none">
          {t.sentTitle}
        </h2>
        <Notice>{t.sent}</Notice>
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOutcome(null)
            }}
          >
            {t.otherAddress}
          </Button>
        </div>
      </div>
    )

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={(event) => void submit(event)}>
      <TextField
        id={`${id}-email`}
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        label={t.email}
        value={email}
        {...(invalid ? { error: t.invalidEmail } : {})}
        onChange={(event) => {
          setEmail(event.target.value)
        }}
      />
      <Button type="submit" size="lg" disabled={busy} className="w-full">
        {busy ? t.busy : t.submit}
      </Button>
      {(outcome === 'tooMany' || outcome === 'error') && <Notice tone="error">{t[outcome]}</Notice>}
      <p className="text-center text-xs text-muted-foreground">{t.firstTime}</p>
    </form>
  )
}
