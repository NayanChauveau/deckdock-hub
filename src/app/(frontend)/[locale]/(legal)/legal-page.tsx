import { MaintenancePage } from '@/core/ui/Maintenance'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { isLocale, type Locale } from '@/core/i18n/locales'
import { messages } from '@/site/messages'
import { legalLabels, legalPath, legalSlugs, type LegalPageKey } from '@/core/i18n/legal'
import { getLegalPages, getSiteData } from '@/site/site-data'
import { alternates, robots } from '@/core/http/seo'
import { maintenanceMetadata, requestMaintenance } from '@/core/http/maintenance'
import { SiteFooter, SiteHeader } from '@/site/SiteChrome'
import { site } from '@/core/site'
import { siteMessages } from '@/site/messages'

interface Props {
  params: Promise<{ locale: string }>
}

/**
 * The legal pages: one folder per public slug (`mentions-legales/page.tsx`, `legal-notice/page.tsx`…,
 * the slugs of src/core/i18n/legal.ts), each serving this page for its key. Any other URL under a
 * language matches no route, so Next renders global-not-found on the server with a real 404.
 * The other language's slug (`/en/mentions-legales`) redirects to the page in the URL's language.
 */
export function legalPage(key: LegalPageKey, slug: string) {
  async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { locale } = await params
    if (!isLocale(locale) || legalSlugs[locale][key] !== slug) return { robots: robots(false) }
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

  async function Page({ params }: Props) {
    const { locale } = await params
    if (!isLocale(locale)) notFound()
    if (legalSlugs[locale][key] !== slug) redirect(legalPath(locale, key))
    return <LegalPage locale={locale} pageKey={key} />
  }

  return { generateMetadata, Page }
}

const pathsFor = (key: LegalPageKey) => ({ fr: legalPath('fr', key), en: legalPath('en', key) })

async function LegalPage({ locale, pageKey: key }: { locale: Locale; pageKey: LegalPageKey }) {
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
      <SiteHeader locale={locale} name={name} paths={pathsFor(key)} />
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
