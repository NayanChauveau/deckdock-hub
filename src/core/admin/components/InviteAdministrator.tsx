'use client'

import { Button, CopyToClipboard, useConfig, useTranslation } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import { useId, useState, type SyntheticEvent } from 'react'
import { accessMessagesFor, responseMessage } from '@/core/admin/messages'

type Result =
  | { delivery: 'email'; email: string }
  | { delivery: 'link'; email: string; link: string; expiresAt: string }

function isResult(value: unknown): value is Result {
  if (typeof value !== 'object' || value === null) return false
  if (!('delivery' in value) || !('email' in value) || typeof value.email !== 'string') return false
  if (value.delivery === 'email') return true
  return (
    value.delivery === 'link' &&
    'link' in value &&
    typeof value.link === 'string' &&
    'expiresAt' in value &&
    typeof value.expiresAt === 'string'
  )
}

/** Above the administrators list: invite by email; the link is shown once if emails are simulated. */
export function InviteAdministrator() {
  const { i18n } = useTranslation()
  const t = accessMessagesFor(i18n.language)
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const router = useRouter()
  const id = useId()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    setError('')
    setResult(null)
    try {
      const response = await fetch(`${serverURL}${api}/users/invite`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.get('email'), name: data.get('name') }),
      })
      if (!response.ok) {
        setError((await responseMessage(response)) ?? t.failed)
        return
      }
      const body: unknown = await response.json()
      if (!isResult(body)) {
        setError(t.failed)
        return
      }
      setResult(body)
      form.reset()
      router.refresh()
    } catch {
      setError(t.failed)
    } finally {
      setPending(false)
    }
  }

  const expiresAt =
    result?.delivery === 'link'
      ? new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : 'fr-FR', {
          dateStyle: 'long',
          timeStyle: 'short',
        }).format(new Date(result.expiresAt))
      : ''

  return (
    <section aria-labelledby={`${id}-title`} style={{ marginBottom: 'var(--base)' }}>
      <h2 id={`${id}-title`} style={{ fontSize: '1.1rem', marginBottom: 'calc(var(--base) / 2)' }}>
        {t.inviteTitle}
      </h2>
      <p>{t.inviteHelp}</p>
      <form
        onSubmit={(event) => void submit(event)}
        style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--base)', alignItems: 'flex-end' }}
      >
        <div className="field-type text" style={{ flex: '1 1 16rem' }}>
          <label className="field-label" htmlFor={`${id}-email`}>
            {t.email}
          </label>
          <div className="field-type__wrap">
            <input id={`${id}-email`} name="email" type="email" required autoComplete="off" />
          </div>
        </div>
        <div className="field-type text" style={{ flex: '1 1 12rem' }}>
          <label className="field-label" htmlFor={`${id}-name`}>
            {t.name}
          </label>
          <div className="field-type__wrap">
            <input id={`${id}-name`} name="name" type="text" required maxLength={100} />
          </div>
        </div>
        <Button type="submit" buttonStyle="secondary" disabled={pending} margin={false}>
          {pending ? t.inviting : t.invite}
        </Button>
      </form>
      <div role="status" aria-live="polite">
        {error ? <p style={{ color: 'var(--theme-error-500)' }}>{error}</p> : null}
        {result?.delivery === 'email' ? <p>{t.sent(result.email)}</p> : null}
        {result?.delivery === 'link' ? (
          <div>
            <p>{t.linkTitle(result.email)}</p>
            <div className="field-type text">
              <label className="field-label" htmlFor={`${id}-link`}>
                {t.linkLabel}
              </label>
              <div
                className="field-type__wrap"
                style={{ display: 'flex', gap: 'calc(var(--base) / 2)', alignItems: 'center' }}
              >
                <input id={`${id}-link`} readOnly value={result.link} />
                <CopyToClipboard value={result.link} />
              </div>
            </div>
            <p>
              <strong>{t.linkWarning(expiresAt)}</strong>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
