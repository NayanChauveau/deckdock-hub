import path from 'node:path'
import type { CollectionConfig } from 'payload'
import { translationStatusField } from '@/core/payload/fields/translation-status'
import { adminOnly } from '@/core/payload/access'

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Image publique', plural: 'Images publiques' },
  admin: {
    useAsTitle: 'alt',
    description: 'Uniquement les images publiques du site. Ne pas importer de photos clients.',
  },
  // A Where constraint makes Payload verify that the static file belongs to this
  // public collection; a bare `true` would also serve arbitrary nested files.
  access: {
    read: () => ({ filename: { exists: true } }),
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  // Public read without a session: excluded from the payload-totp wrapper (writes stay wrapped).
  custom: { totp: { disableAccessWrapper: { read: true } } },
  upload: {
    // Runtime volume: do not include uploaded files in the application bundle.
    staticDir: path.resolve(
      /* turbopackIgnore: true */ process.env['MEDIA_DIR'] || 'storage/media',
    ),
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    imageSizes: [
      { name: 'thumbnail', width: 400, height: 400, fit: 'inside', withoutEnlargement: true },
    ],
  },
  fields: [
    translationStatusField('media'),
    { name: 'alt', label: 'Texte alternatif', type: 'text', required: true, localized: true },
  ],
}
