import path from 'node:path'
import type { CollectionConfig } from 'payload'
import { adminOnly } from '@/core/payload/access'
export const CustomerPhotos: CollectionConfig = {
  slug: 'customer-photos',
  labels: { singular: 'Photo client privée', plural: 'Photos clients privées' },
  admin: {
    description:
      'Photos privées normalisées sans métadonnées. Import via le parcours de commande uniquement.',
  },
  access: { read: adminOnly, create: () => false, update: () => false, delete: () => false },
  upload: {
    staticDir: path.resolve(
      /* turbopackIgnore: true */ process.env['MEDIA_DIR'] || 'storage/media',
      'private',
    ),
    mimeTypes: ['image/jpeg'],
    modifyResponseHeaders: ({ headers }) => {
      headers.set('Cache-Control', 'private, no-store')
      headers.set('X-Content-Type-Options', 'nosniff')
      return headers
    },
  },
  fields: [
    {
      name: 'expiresAt',
      label: 'Suppression prévue (imports abandonnés)',
      type: 'date',
      index: true,
      required: true,
    },
  ],
}
