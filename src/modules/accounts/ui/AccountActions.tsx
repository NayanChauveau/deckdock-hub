'use client'
import { useEffect, useRef, useState } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { Notice } from '@/core/ui/feedback/Notice'
import { accountMessages } from '../messages'
import { accountPath, signInPath } from '../paths'

const post = (path: string, body: unknown = {}) =>
  fetch(`/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

/** A full navigation: nothing of the signed-in page stays in the client router's cache. */
const leave = (url: string) => {
  window.location.assign(url)
}

/**
 * Signing out (here or on every device) and asking for the deletion of the account. The deletion
 * is confirmed twice: here, then by the link of the email it sends.
 */
export function AccountActions({
  locale,
  email,
  navigate = leave,
}: {
  locale: Locale
  email: string
  navigate?: (url: string) => void
}) {
  const t = accountMessages[locale].account
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deletionSent, setDeletionSent] = useState(false)
  // Focus follows the deletion steps: the question when it opens, the button again if cancelled.
  const question = useRef<HTMLParagraphElement>(null)
  const start = useRef<HTMLButtonElement>(null)
  const opened = useRef(false)
  useEffect(() => {
    if (confirming) question.current?.focus()
    else if (opened.current) start.current?.focus()
    opened.current ||= confirming
  }, [confirming])

  // A page cannot set cookies: Better Auth's own route extends the session (and its cookie) here.
  useEffect(() => {
    // The body is read to the end: an unread answer stays open in the browser.
    void fetch('/api/auth/get-session')
      .then((response) => response.arrayBuffer())
      .catch(() => undefined)
  }, [])

  async function act(path: string, body: unknown, done: () => void) {
    setBusy(true)
    setFailed(false)
    try {
      const response = await post(path, body)
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      done()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  const signOut = (path: 'sign-out' | 'revoke-sessions') =>
    void act(path, {}, () => {
      navigate(signInPath(locale))
    })
  const requestDeletion = () =>
    void act('delete-user', { callbackURL: accountPath(locale) }, () => {
      setConfirming(false)
      setDeletionSent(true)
    })

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="account-sessions" className="flex flex-col gap-4">
        <h2 id="account-sessions">{t.sessionsTitle}</h2>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={busy}
            onClick={() => {
              signOut('sign-out')
            }}
          >
            {t.signOut}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            aria-describedby="account-everywhere-hint"
            onClick={() => {
              signOut('revoke-sessions')
            }}
          >
            {t.signOutEverywhere}
          </Button>
        </div>
        <p id="account-everywhere-hint" className="text-muted-foreground">
          {t.signOutEverywhereHint}
        </p>
      </section>
      <section aria-labelledby="account-delete" className="flex flex-col gap-4">
        <h2 id="account-delete">{t.deleteTitle}</h2>
        <p>{t.deleteIntro}</p>
        {deletionSent ? (
          <Notice>{t.deletionSent(email)}</Notice>
        ) : confirming ? (
          <div className="flex flex-col gap-4">
            <p ref={question} tabIndex={-1} className="font-semibold">
              {t.deleteConfirmQuestion}
            </p>
            <div className="flex flex-wrap gap-3">
              <Button type="button" variant="destructive" disabled={busy} onClick={requestDeletion}>
                {busy ? t.busy : t.deleteConfirm}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setConfirming(false)
                }}
              >
                {t.deleteCancel}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button
              ref={start}
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                setConfirming(true)
              }}
            >
              {t.deleteStart}
            </Button>
          </div>
        )}
      </section>
      {failed && <Notice tone="error">{t.error}</Notice>}
    </div>
  )
}
