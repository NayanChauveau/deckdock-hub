import { getPayload } from 'payload'
import config from '../payload.config'
import { site } from '../core/site'
import { fillEmptyLegalPages } from '../site/legal-placeholders'

const payload = await getPayload({ config })
try {
  // Only initialize completely absent globals: never overwrite partial real content.
  const content = await payload.findGlobal({
    slug: 'site-content',
    locale: 'fr',
    fallbackLocale: false,
  })
  if (!content.id) {
    await payload.updateGlobal({
      slug: 'site-content',
      locale: 'fr',
      data: {
        title: 'Bienvenue',
        description: 'Contenu de démonstration à remplacer avant publication.',
      },
    })
    await payload.updateGlobal({
      slug: 'site-content',
      locale: 'en',
      data: {
        title: 'Welcome',
        description: 'Demo content to replace before publication.',
      },
    })
  }
  const settings = await payload.findGlobal({ slug: 'site-settings' })
  if (!settings.id) {
    await payload.updateGlobal({
      slug: 'site-settings',
      locale: 'fr',
      data: { siteName: site.identity.displayName, footerText: 'Site en préparation' },
    })
    await payload.updateGlobal({
      slug: 'site-settings',
      locale: 'en',
      data: { siteName: site.identity.displayName, footerText: 'Website in preparation' },
    })
  }
  await fillEmptyLegalPages(payload)
  console.log(
    'Données de démonstration initialisées ; contenus existants conservés. Aucun compte créé.',
  )
} finally {
  await payload.destroy()
}
