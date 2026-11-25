import type { MetadataRoute } from 'next'
import { publicIndexing, siteURL } from '@/core/http/seo'

// Read at request time: indexing is switched by the deployment, not by a rebuild.
export const dynamic = 'force-dynamic'

export default function robots(): MetadataRoute.Robots {
  if (!publicIndexing()) return { rules: { userAgent: '*', disallow: '/' } }
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/api/',
        '/fr/commande/suivi',
        '/en/commande/suivi',
        '/fr/commande/acces',
        '/en/commande/acces',
      ],
    },
    sitemap: new URL('/sitemap.xml', siteURL()).toString(),
  }
}
