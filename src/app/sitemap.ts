import type { MetadataRoute } from 'next'
import { guidePath, guideSlugs } from '@/core/i18n/guide'
import { legalPageKeys, legalPath } from '@/core/i18n/legal'
import { publicIndexing, siteURL } from '@/core/http/seo'

export const dynamic = 'force-dynamic'

/** Public pages only, each with its French and English versions. Empty until indexing is enabled. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!publicIndexing()) return []
  const absolute = (path: string) => new URL(path, siteURL()).toString()
  const pages: Record<'fr' | 'en', string>[] = [
    { fr: '/fr', en: '/en' },
    { fr: '/fr/decks', en: '/en/decks' },
    ...legalPageKeys.map((key) => ({ fr: legalPath('fr', key), en: legalPath('en', key) })),
    // The author guide (src/site/guide): its home and each page.
    { fr: guidePath('fr'), en: guidePath('en') },
    ...guideSlugs.map((slug) => ({ fr: guidePath('fr', slug.fr), en: guidePath('en', slug.en) })),
  ]
  return pages.flatMap((paths) =>
    (['fr', 'en'] as const).map((locale) => ({
      url: absolute(paths[locale]),
      alternates: {
        languages: {
          fr: absolute(paths.fr),
          en: absolute(paths.en),
          'x-default': absolute(paths.fr),
        },
      },
    })),
  )
}
