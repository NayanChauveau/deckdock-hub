'use client'
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { Notice } from '@/core/ui/feedback/Notice'
import { orderMessages } from '../messages'
import { paymentRetrySchema } from '@/modules/orders/contracts'
export function OrderStatus(props: {
  locale: Locale
  reference: string
  pending: boolean
  simulated: boolean
  canRetry?: boolean
  leftCheckout?: boolean
}) {
  const router = useRouter()
  const refresh = useCallback(() => {
    router.refresh()
  }, [router])
  return <OrderStatusView {...props} refresh={refresh} />
}
export function OrderStatusView({
  locale,
  reference,
  pending,
  simulated,
  canRetry = false,
  leftCheckout = false,
  refresh,
}: {
  locale: Locale
  reference: string
  pending: boolean
  simulated: boolean
  canRetry?: boolean
  leftCheckout?: boolean
  refresh: () => void
}) {
  const t = orderMessages[locale]
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checkingPayment, setCheckingPayment] = useState(false)
  const waiting = pending || (canRetry && checkingPayment)
  useEffect(() => {
    if (!waiting) return
    let attempts = 0
    const timer = setInterval(() => {
      if (++attempts > 24) clearInterval(timer)
      else refresh()
    }, 5000)
    return () => {
      clearInterval(timer)
    }
  }, [waiting, refresh])
  async function pay(action: 'simulate' | 'retry') {
    setBusy(true)
    setError('')
    try {
      const response = await fetch(`/api/commerce/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      })
      if (!response.ok) throw new Error()
      if (action === 'retry') {
        const result = paymentRetrySchema.parse(await response.json())
        if (result.url) {
          window.location.assign(result.url)
          return
        }
        setCheckingPayment(true)
      }
      refresh()
    } catch {
      setError(action === 'retry' ? t.retryError : t.error)
      if (action === 'retry') refresh()
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      {pending && !leftCheckout && !checkingPayment && <Notice>{t.confirmation}</Notice>}
      {canRetry && !checkingPayment && (
        <>
          <Notice>{t.retryHint}</Notice>
          <Button
            type="button"
            size="lg"
            className="my-3"
            disabled={busy}
            onClick={() => {
              void pay('retry')
            }}
          >
            {busy ? t.retryBusy : t.retryPayment}
          </Button>
        </>
      )}
      {canRetry && checkingPayment && <Notice>{t.paymentProcessing}</Notice>}
      {simulated && pending && (
        <Button
          type="button"
          size="lg"
          className="my-3"
          disabled={busy}
          onClick={() => {
            void pay('simulate')
          }}
        >
          {busy ? t.simulationBusy : t.simulate}
        </Button>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </>
  )
}
