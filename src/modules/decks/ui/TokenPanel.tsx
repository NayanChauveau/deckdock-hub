'use client'
import { useEffect, useRef, useState } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { Notice } from '@/core/ui/feedback/Notice'
import { deckMessages, failureText } from '../messages'
import {
  failureOf,
  type Failed,
  type Failure,
  type RevokeResult,
  type TokenResult,
} from './results'
import { TokenReveal } from './TokenReveal'

type Step = 'idle' | 'regenerate' | 'revoke'
type Outcome = 'revoked' | Failure | null

/**
 * Regenerating (the new token is shown once) and revoking a deck's token. Both are confirmed first:
 * either one stops the token in the repository's secret from working.
 */
export function TokenPanel({
  locale,
  deckId,
  regenerate,
  revoke,
}: {
  locale: Locale
  deckId: string
  regenerate: (deckId: string) => Promise<TokenResult>
  revoke: (deckId: string) => Promise<RevokeResult>
}) {
  const messages = deckMessages[locale]
  const t = messages.token
  const [step, setStep] = useState<Step>('idle')
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome>(null)
  const question = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (step !== 'idle') question.current?.focus()
  }, [step])

  const failed = (result: Failed) => {
    setOutcome(failureOf(result.error))
  }
  async function confirm() {
    setBusy(true)
    setOutcome(null)
    try {
      if (step === 'regenerate') {
        const result = await regenerate(deckId)
        if (result.ok) setToken(result.token)
        else failed(result)
      } else {
        const result = await revoke(deckId)
        if (result.ok) {
          setToken(null)
          setOutcome('revoked')
        } else failed(result)
      }
    } catch {
      setOutcome('error')
    } finally {
      setBusy(false)
      setStep('idle')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {step === 'idle' ? (
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setStep('regenerate')
            }}
          >
            {t.regenerate}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              setStep('revoke')
            }}
          >
            {t.revoke}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <p ref={question} tabIndex={-1} className="font-semibold">
            {step === 'regenerate' ? t.regenerateQuestion : t.revokeQuestion}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant={step === 'revoke' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy
                ? messages.common.busy
                : step === 'regenerate'
                  ? t.regenerateConfirm
                  : t.revokeConfirm}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setStep('idle')
              }}
            >
              {t.cancel}
            </Button>
          </div>
        </div>
      )}
      {token && (
        <TokenReveal
          locale={locale}
          token={token}
          onHide={() => {
            setToken(null)
          }}
        />
      )}
      {outcome === 'revoked' && <Notice>{t.revoked}</Notice>}
      {outcome && outcome !== 'revoked' && (
        <Notice tone="error">{failureText(messages, outcome)}</Notice>
      )}
    </div>
  )
}
