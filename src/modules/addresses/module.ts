import type { SiteModule } from '@/core/modules/types'

export const addressesModule: SiteModule = {
  name: 'addresses',
  dependsOn: [],
  routes: [
    'src/app/(frontend)/api/addresses/route.ts',
    'src/app/(frontend)/api/addresses/details/route.ts',
  ],
  files: ['tests/addresses.test.ts', 'tests/addresses.http.test.ts', 'tests/addresses.ui.test.tsx'],
}
