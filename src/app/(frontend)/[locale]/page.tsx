import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { maintenanceMetadata } from '@/core/http/maintenance'
import { alternates, robots, sharingMetadata } from '@/core/http/seo'
import { isLocale } from '@/core/i18n/locales'
import { RecentDecks } from '@/modules/decks/ui/RecentDecks'
import { homeContent } from '@/site/home-content'
import { HomePage, RecentDecksEmpty } from '@/site/HomePage'
import { siteMessages } from '@/site/messages'
import { PublicShell } from '@/site/PublicShell'
import { homePaths, SITE_NAME } from '@/site/SiteChrome'

export const dynamic = 'force-dynamic'
interface Props {
  params: Promise<{ locale: string }>
}

/** The homepage's metadata, written in code (src/site/home-content.ts) under the name DeckDock. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const closed = await maintenanceMetadata(locale, siteMessages[locale].maintenanceText)
  if (closed) return closed
  const t = homeContent[locale]
  return {
    title: t.metaTitle,
    description: t.metaDescription,
    alternates: alternates(locale, homePaths),
    robots: robots(true),
    ...sharingMetadata({
      locale,
      path: homePaths[locale],
      siteName: SITE_NAME,
      title: t.metaTitle,
      description: t.metaDescription,
      images: [],
    }),
  }
}

/** The DeckDock homepage, in the site's frame; its recent decks come from the decks module. */
export default async function Home({ params }: Props) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  // While visitors are kept out, PublicShell renders nothing: no deck is read.
  return (
    <PublicShell locale={locale} paths={homePaths}>
      <HomePage
        locale={locale}
        recent={<RecentDecks locale={locale} empty={<RecentDecksEmpty locale={locale} />} />}
      />
    </PublicShell>
  )
}
