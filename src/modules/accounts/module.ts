import { extensionsOf } from '@/core/modules/resolve'
import type { SiteModule } from '@/core/modules/types'
import { isAdmin } from '@/core/payload/access'
import { customersCollection } from './adapters/payload/Customers'
import { isAccountsExtension } from './extension'
import { emailPreviews } from './email-previews'
import { getAuth, sweepOrphans } from './server'

/** Visitor accounts in Payload; the site's administrators read and delete them. */
export const Customers = customersCollection({
  isAdmin,
  getAuth,
  // What other modules do when an account goes (extensions.accounts, see extension.ts).
  beforeDelete: async ({ req, customerId }) => {
    for (const extension of extensionsOf(req.payload, 'accounts', isAccountsExtension))
      await extension.beforeCustomerDelete?.({ req, customerId })
  },
})

/** Visitor accounts: Better Auth in its own `auth` schema, bridged to Payload by this module. */
export const accountsModule: SiteModule = {
  name: 'accounts',
  dependsOn: [],
  collections: [Customers],
  // Slug, queue and schedule kept as they are: a renamed queue would strand the job already
  // scheduled in production.
  tasks: [
    {
      // Customers whose Better Auth user is gone: what an interrupted deletion leaves behind.
      slug: 'accounts-orphan-sweep',
      retries: 2,
      schedule: [{ cron: '17 * * * *', queue: 'accounts' }],
      handler: async ({ req }) => {
        await sweepOrphans(req.payload)
        return { output: {} }
      },
    },
  ],
  queues: ['accounts'],
  // Only this module reads it: a site without accounts never needs it.
  secrets: ['BETTER_AUTH_SECRET'],
  migrations: [
    '20261125_150000_accounts_auth_schema',
    '20261125_151000_accounts_customers',
    '20261125_152000_accounts_orphan_sweep',
  ],
  emailPreviews,
  routes: [
    'src/app/(frontend)/api/auth/[...all]/route.ts',
    'src/app/(frontend)/[locale]/compte/page.tsx',
    'src/app/(frontend)/[locale]/compte/connexion/page.tsx',
    'src/app/(frontend)/[locale]/compte/supprime/page.tsx',
  ],
  files: [
    'tests/accounts.test.ts',
    'tests/accounts.integration.ts',
    'tests/accounts.http.ts',
    'tests/accounts-admin.http.ts',
    'tests/accounts.ui.test.tsx',
    'tests/e2e/accounts.spec.ts',
  ],
}
