'use client'
import { useId, useState, type SyntheticEvent } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { Notice } from '@/core/ui/feedback/Notice'
import { TextField } from '@/core/ui/forms/TextField'
import { accountMessages } from '../messages'
import { accountPath } from '../paths'

type Outcome = 'sent' | 'tooMany' | 'error' | null

/**
 * Asks Better Auth for a magic link. The answer is the same whether or not the address has an
 * account, and so is the message shown.
 */
export function SignInForm({ locale }: { locale: Locale }) {
  const t = accountMessages[locale].signIn
  const id = useId()
  const [email, setEmail] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>(null)

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

  return (
    <form className="flex flex-col gap-6" noValidate onSubmit={(event) => void submit(event)}>
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
      <div>
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? t.busy : t.submit}
        </Button>
      </div>
      {outcome === 'sent' && <Notice>{t.sent}</Notice>}
      {(outcome === 'tooMany' || outcome === 'error') && <Notice tone="error">{t[outcome]}</Notice>}
    </form>
  )
}
