import { orderMessages } from '@/modules/orders/messages'
import type { Metadata } from 'next'
import { MaintenancePage } from '@/core/ui/Maintenance'
import { maintenanceMetadata, requestMaintenance } from '@/core/http/maintenance'
import { notFound } from 'next/navigation'
import { isLocale } from '@/core/i18n/locales'
import { OrderAccess } from '@/modules/orders/ui/OrderAccess'
import { site } from '@/core/site'
import { siteMessages } from '@/site/messages'
// Private pages: a plain title, never the customer's details; the layout already sets noindex.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) return {}
  const closed = await maintenanceMetadata(locale, siteMessages[locale].maintenanceText)
  if (closed) return closed
  return { title: `${orderMessages[locale].order} | ${site.identity.displayName}` }
}
export default async function AccessPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  if ((await requestMaintenance()).visitorBlocked)
    return <MaintenancePage locale={locale} text={siteMessages[locale].maintenanceText} />
  return (
    <main className="commerce-page">
      <OrderAccess locale={locale} />
    </main>
  )
}
