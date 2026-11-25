'use client'

import {
  Button,
  CopyToClipboard,
  useAuth,
  useConfig,
  useDocumentInfo,
  useTranslation,
} from '@payloadcms/ui'
import { useId, useState } from 'react'
import { accessMessagesFor, responseMessage } from '@/core/admin/messages'

/** On another administrator's page: reset their TOTP (phone lost). Never on one's own page. */
export function ResetTotpButton() {
  const { i18n } = useTranslation()
  const t = accessMessagesFor(i18n.language)
  const { id } = useDocumentInfo()
  const { user } = useAuth()
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const title = useId()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [link, setLink] = useState('')

  if (id === undefined) return null
  const own = Boolean(user) && String(user?.id) === String(id)

  async function reset() {
    setPending(true)
    setMessage('')
    setLink('')
    try {
      const response = await fetch(
        `${serverURL}${api}/users/${encodeURIComponent(String(id))}/reset-totp`,
        { method: 'POST', credentials: 'include' },
      )
      if (!response.ok) {
        setMessage((await responseMessage(response)) ?? t.resetFailed)
        return
      }
      const body: unknown = await response.json()
      const shown =
        typeof body === 'object' && body !== null && 'link' in body && typeof body.link === 'string'
          ? body.link
          : ''
      // Simulated email: the link is shown once, to be passed on by this administrator.
      setLink(shown)
      setMessage(shown ? t.resetLink : t.resetDone)
    } catch {
      setMessage(t.resetFailed)
    } finally {
      setPending(false)
      setConfirming(false)
    }
  }

  return (
    <section className="field-type" aria-labelledby={title}>
      <h3 id={title} className="field-label">
        {t.resetTitle}
      </h3>
      {own ? (
        <p>{t.resetOwn}</p>
      ) : (
        <>
          <p>{t.resetHelp}</p>
          {confirming ? (
            <div style={{ display: 'flex', gap: 'calc(var(--base) / 2)', flexWrap: 'wrap' }}>
              <Button
                type="button"
                buttonStyle="primary"
                disabled={pending}
                margin={false}
                onClick={() => void reset()}
              >
                {t.confirm}
              </Button>
              <Button
                type="button"
                buttonStyle="secondary"
                disabled={pending}
                margin={false}
                onClick={() => {
                  setConfirming(false)
                }}
              >
                {t.cancel}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              buttonStyle="secondary"
              margin={false}
              onClick={() => {
                setConfirming(true)
              }}
            >
              {t.reset}
            </Button>
          )}
        </>
      )}
      <div role="status" aria-live="polite">
        <p>{message}</p>
        {link ? (
          <div
            className="field-type__wrap"
            style={{ display: 'flex', gap: 'calc(var(--base) / 2)', alignItems: 'center' }}
          >
            <input aria-label={t.linkLabel} readOnly value={link} />
            <CopyToClipboard value={link} />
          </div>
        ) : null}
      </div>
    </section>
  )
}
