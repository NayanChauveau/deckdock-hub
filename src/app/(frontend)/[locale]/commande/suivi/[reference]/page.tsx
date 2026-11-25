import type { Metadata } from 'next'
import { MaintenancePage } from '@/core/ui/Maintenance'
import { maintenanceMetadata, requestMaintenance } from '@/core/http/maintenance'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { getOrders } from '@/modules/orders/server'
import { isLocale } from '@/core/i18n/locales'
import { orderMessages } from '@/modules/orders/messages'
import { OrderError } from '@/modules/orders/domain/errors'
import { OrderStatus } from '@/modules/orders/ui/OrderStatus'
import { site } from '@/core/site'
import { isOrderReference, orderCookieName } from '@/modules/orders/reference'
import { siteMessages } from '@/site/messages'
import { activeAnalytics } from '@/core/http/analytics'
import { PurchaseEvent } from '@/modules/orders/ui/PurchaseEvent'
export const dynamic = 'force-dynamic'
// Private pages: a plain title, never the customer's details; the layout already sets noindex.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; reference: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const closed = await maintenanceMetadata(locale, siteMessages[locale].maintenanceText)
  if (closed) return closed
  return { title: `${orderMessages[locale].order} | ${site.identity.displayName}` }
}
export default async function Tracking({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; reference: string }>
  searchParams: Promise<{ cancelled?: string | string[]; paid?: string | string[] }>
}) {
  const { locale, reference } = await params
  if (!isLocale(locale) || !isOrderReference(reference)) notFound()
  if ((await requestMaintenance()).visitorBlocked)
    return <MaintenancePage locale={locale} text={siteMessages[locale].maintenanceText} />
  const order = await (
    await getOrders()
  ).orders
    .tracking(reference, (await cookies()).get(orderCookieName(reference))?.value)
    .catch((error: unknown) => {
      if (error instanceof OrderError && ['not_found', 'reference'].includes(error.code)) notFound()
      throw error
    })
  const query = await searchParams
  const leftCheckout = query.cancelled === '1'
  // Back from the payment page and paid (the page refreshes while pending): revenue measured once.
  const reportPaid =
    query.paid === '1' &&
    order.paymentStatus === 'paid' &&
    activeAnalytics(site, process.env.NODE_ENV) !== null
  const pending = order.paymentStatus === 'pending'
  const canRetry = order.canRetry && (!pending || leftCheckout)
  const t = orderMessages[locale]
  const money = new Intl.NumberFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    style: 'currency',
    currency: 'EUR',
  })
  return (
    <main className="commerce-page order-tracking">
      <Link href={`/${locale}`} className="text-link">
        ← {t.back}
      </Link>
      <h1>{t.order}</h1>
      <p>
        {t.reference} : <strong>{reference}</strong>
      </p>
      <dl>
        <div>
          <dt>{t.payment}</dt>
          <dd>{pending && leftCheckout ? t.expired : t[order.paymentStatus]}</dd>
        </div>
        <div>
          <dt>{t.progress}</dt>
          <dd>{t[order.fulfillmentStatus]}</dd>
        </div>
        <div>
          <dt>{t.total}</dt>
          <dd>{money.format(order.totalCents / 100)}</dd>
        </div>
      </dl>
      {reportPaid && (
        <PurchaseEvent
          reference={reference}
          locale={locale}
          amountCents={order.totalCents}
          currency="EUR"
        />
      )}
      <OrderStatus
        locale={locale}
        reference={reference}
        pending={pending}
        leftCheckout={leftCheckout}
        canRetry={canRetry}
        simulated={order.simulated}
      />
      {order.trackingNumber && (
        <p>
          {t.tracking} : {order.trackingNumber}
        </p>
      )}
    </main>
  )
}
