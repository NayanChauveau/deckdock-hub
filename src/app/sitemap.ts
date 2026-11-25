import type { MetadataRoute } from 'next'
import { legalPageKeys, legalPath } from '@/core/i18n/legal'
import { publicIndexing, siteURL } from '@/core/http/seo'

export const dynamic = 'force-dynamic'

/** Public pages only, each with its French and English versions. Empty until indexing is enabled. */
export default function sitemap(): MetadataRoute.Sitemap {
  if (!publicIndexing()) return []
  const absolute = (path: string) => new URL(path, siteURL()).toString()
  const pages: Record<'fr' | 'en', string>[] = [
    { fr: '/fr', en: '/en' },
    { fr: '/fr/commande', en: '/en/commande' },
    ...legalPageKeys.map((key) => ({ fr: legalPath('fr', key), en: legalPath('en', key) })),
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
