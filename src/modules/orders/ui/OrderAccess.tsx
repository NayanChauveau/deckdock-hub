'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { orderLinkSchema } from '@/modules/orders/contracts'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/core/i18n/locales'
export function OrderAccess(props: { locale: Locale }) {
  const router = useRouter()
  const replace = useCallback(
    (url: string) => {
      router.replace(url)
    },
    [router],
  )
  return <OrderAccessView {...props} replace={replace} />
}
export function OrderAccessView({
  locale,
  replace,
}: {
  locale: Locale
  replace: (url: string) => void
}) {
  const [failed, setFailed] = useState(false)
  const credentials = useRef<URLSearchParams | null>(null)
  useEffect(() => {
    credentials.current ??= new URLSearchParams(window.location.hash.slice(1))
    const values = credentials.current
    // Fragments never reach HTTP access logs. Clear it before making any request.
    window.history.replaceState(null, '', window.location.pathname)
    let active = true
    void fetch('/api/commerce/access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reference: values.get('reference'),
        token: values.get('token'),
        locale,
      }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        const body: unknown = await response.json()
        return orderLinkSchema.parse(body)
      })
      .then((result) => {
        if (active) replace(result.url)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [locale, replace])
  return (
    <p role="status">
      {failed
        ? locale === 'fr'
          ? 'Lien invalide. Utilisez le lien personnel de votre email.'
          : 'Invalid link. Please use the private link in your email.'
        : locale === 'fr'
          ? 'Ouverture de votre commande…'
          : 'Opening your order…'}
    </p>
  )
}
