import type { SiteModule } from '@/core/modules/types'
import { CustomerPhotos } from './CustomerPhotos'

/** Private customer uploads (photos): validation, re-encoding and private storage with expiry. */
export const customerUploadsModule: SiteModule = {
  name: 'customer-uploads',
  dependsOn: [],
  collections: [CustomerPhotos],
  files: ['tests/customer-uploads.test.ts'],
}
