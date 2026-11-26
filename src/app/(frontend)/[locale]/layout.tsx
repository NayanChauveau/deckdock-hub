import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Analytics } from '@/core/ui/Analytics'
import { MaintenanceBanner, MaintenancePage } from '@/core/ui/Maintenance'
import { isLocale } from '@/core/i18n/locales'
import { mediaURL, robots, siteURL } from '@/core/http/seo'
import { getSiteData } from '@/site/site-data'
import { requestMaintenance } from '@/core/http/maintenance'
import '@/styles/globals.css'
import { site } from '@/core/site'
import { SiteIdentityProvider } from '@/core/ui/site-identity'
import { siteMessages } from '@/site/messages'
import { ThemeScript } from '@/core/ui/theme/ThemeScript'
import { ThemeSync } from '@/core/ui/theme/ThemeToggle'

// Pages opt into indexing individually; anything else (tracking, errors) stays noindex.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const data = isLocale(locale) ? await getSiteData(locale).catch(() => null) : null
  const favicon = data?.settings.favicon
  const icon =
    favicon && typeof favicon === 'object' && favicon.filename
      ? mediaURL(favicon.filename)
      : '/site-icon.svg'
  return { metadataBase: siteURL(), robots: robots(false), icons: { icon } }
}

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  // Every public page, legal pages and order tracking included, goes through this gate.
  const maintenance = await requestMaintenance()
  return (
    // The boot script sets the theme class on <html> before React hydrates it.
    <html lang={locale} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <SiteIdentityProvider identity={{ displayName: site.identity.displayName }}>
          {maintenance.visitorBlocked ? (
            <MaintenancePage locale={locale} text={siteMessages[locale].maintenanceText} />
          ) : (
            <>
              {maintenance.active && <MaintenanceBanner locale={locale} />}
              {children}
            </>
          )}
        </SiteIdentityProvider>
        <ThemeSync />
        <Analytics />
      </body>
    </html>
  )
}
