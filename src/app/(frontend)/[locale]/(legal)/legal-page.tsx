import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { RichText } from '@payloadcms/richtext-lexical/react'
import { isLocale, type Locale } from '@/core/i18n/locales'
import { messages } from '@/site/messages'
import { legalLabels, legalPath, legalSlugs, type LegalPageKey } from '@/core/i18n/legal'
import { getLegalPages } from '@/site/site-data'
import { alternates, robots } from '@/core/http/seo'
import { maintenanceMetadata } from '@/core/http/maintenance'
import { PublicShell } from '@/site/PublicShell'
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
    // While visitors are kept out, PublicShell renders nothing: the page is never read.
    return (
      <PublicShell locale={locale} paths={pathsFor(key)}>
        <LegalPage locale={locale} pageKey={key} />
      </PublicShell>
    )
  }

  return { generateMetadata, Page }
}

const pathsFor = (key: LegalPageKey) => ({ fr: legalPath('fr', key), en: legalPath('en', key) })

async function LegalPage({ locale, pageKey: key }: { locale: Locale; pageKey: LegalPageKey }) {
  const t = messages[locale]
  const pages = await getLegalPages(locale)
  const page = pages[key]
  return (
    <div className="legal-page">
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
    </div>
  )
}
