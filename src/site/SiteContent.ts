import type { GlobalConfig } from 'payload'
import { translationStatusField } from '@/core/payload/fields/translation-status'
import { adminOnly, publicRead } from '@/core/payload/access'
export const SiteContent: GlobalConfig = {
  slug: 'site-content',
  label: 'Contenu du site',
  access: { read: publicRead, update: adminOnly },
  // Public read without a session: excluded from the payload-totp wrapper (writes stay wrapped).
  custom: { totp: { disableAccessWrapper: { read: true } } },
  fields: [
    translationStatusField('site-content'),
    { name: 'title', label: 'Titre', type: 'text', required: true, localized: true },
    {
      name: 'description',
      label: 'Présentation',
      type: 'textarea',
      required: true,
      localized: true,
    },
    { name: 'heroImage', label: 'Image principale', type: 'upload', relationTo: 'media' },
    { name: 'seoTitle', label: 'Titre SEO', type: 'text', localized: true },
    { name: 'seoDescription', label: 'Description SEO', type: 'textarea', localized: true },
    {
      name: 'seoImage',
      label: 'Image de partage de l’accueil',
      type: 'upload',
      relationTo: 'media',
      admin: {
        description: 'À défaut, l’image principale est utilisée. Format conseillé : 1200 × 630 px.',
      },
    },
  ],
}
