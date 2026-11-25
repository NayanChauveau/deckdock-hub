'use client'
import { useEffect } from 'react'
import { reportPurchase, type Purchase } from '@/core/http/analytics'

/**
 * Reports a completed payment to the audience measurement (src/core/http/analytics.ts), once per
 * browser. Rendered by the tracking page only on the return from the payment page, once paid,
 * and only when the tracker is on. The tracker is deferred: tries again for ten seconds at most.
 */
export function PurchaseEvent({ reference, ...purchase }: Purchase & { reference: string }) {
  const { locale, amountCents, currency } = purchase
  useEffect(() => {
    let attempts = 0
    const timer = setInterval(() => {
      const result = reportPurchase(window, reference, { locale, amountCents, currency })
      if (result !== 'no-tracker' || ++attempts >= 20) clearInterval(timer)
    }, 500)
    return () => {
      clearInterval(timer)
    }
  }, [reference, locale, amountCents, currency])
  return null
}
