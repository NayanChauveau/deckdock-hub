import { MaintenancePage } from '@/core/ui/Maintenance'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { isLocale, type Locale } from '@/core/i18n/locales'
import { messages } from '@/site/messages'
import { legalLabels, legalPageFromSlug, legalPath, type LegalPageKey } from '@/core/i18n/legal'
import { getLegalPages, getSiteData } from '@/site/site-data'
import { alternates, robots } from '@/core/http/seo'
import { maintenanceMetadata, requestMaintenance } from '@/core/http/maintenance'
import { SiteFooter, SiteHeader } from '@/site/SiteChrome'
import { site } from '@/core/site'
import { siteMessages } from '@/site/messages'

export const dynamic = 'force-dynamic'
interface Props {
  params: Promise<{ locale: string; slug: string[] }>
}

// Catch-all: any other URL under a language falls through to the localized 404.
function match(locale: string, slug: string[]): { locale: Locale; key: LegalPageKey } | null {
  if (!isLocale(locale)) return null
  const key = slug.length === 1 && slug[0] ? legalPageFromSlug(locale, slug[0]) : null
  return key ? { locale, key } : null
}
const pathsFor = (key: LegalPageKey) => ({ fr: legalPath('fr', key), en: legalPath('en', key) })

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const route = await params
  // notFound() here would escape the [locale] boundary and show Next's default page; the page throws it instead.
  const found = match(route.locale, route.slug)
  if (!found) return { robots: robots(false) }
  const { locale, key } = found
  const closed = await maintenanceMetadata(locale, siteMessages[locale].maintenanceText)
  if (closed) return closed
  const pages = await getLegalPages(locale).catch(() => null)
  const title = pages?.[key].title || legalLabels[locale][key]
  return {
    title: `${title} | ${site.identity.displayName}`,
    // Search engines show a description; legal pages have no summary field, so it is their title.
    description: `${title} – ${site.identity.displayName}`,
    alternates: alternates(locale, pathsFor(key)),
    robots: robots(true),
  }
}

export default async function LegalPage({ params }: Props) {
  const { locale: rawLocale, slug } = await params
  const found = match(rawLocale, slug)
  if (!found) notFound()
  const { locale, key } = found
  if ((await requestMaintenance()).visitorBlocked)
    return <MaintenancePage locale={locale} text={siteMessages[locale].maintenanceText} />
  const t = messages[locale]
  const [pages, { settings }] = await Promise.all([getLegalPages(locale), getSiteData(locale)])
  const page = pages[key]
  const name = settings.siteName || site.identity.displayName
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <SiteHeader
        locale={locale}
        name={name}

        paths={pathsFor(key)}
      />
      <main id="main" className="legal-page">
        <p className="eyebrow">{t.legalNavigation}</p>
        <h1>{page.title || legalLabels[locale][key]}</h1>
        <div className="legal-body">
          {page.body ? <RichText data={page.body} disableContainer /> : <p>{t.legalPending}</p>}
        </div>
        {key === 'terms' && (
          <p className="legal-meta">
            {t.legalUpdated} : {pages.terms.version}
          </p>
        )}
      </main>
      <SiteFooter locale={locale} name={name} text={settings.footerText} />
    </div>
  )
}
