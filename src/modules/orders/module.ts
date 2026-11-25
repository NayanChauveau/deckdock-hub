import type { SiteModule } from '@/core/modules/types'
import { OrderSettings, ordersCollections } from './adapters/payload/collections'
import { orderExtensions } from './adapters/payload/persistence-extension'
import { createOrders } from './composition'
import { emailPreviews } from './email-previews'

/**
 * Generic orders: lines, payment state, private tracking, outbox and order emails. Its `orders`
 * slot takes one selling extension (`kind`) and one payment module (`payments`).
 */
export const ordersModule: SiteModule = {
  name: 'orders',
  dependsOn: [],
  setup: (context) => ({
    collections: ordersCollections(orderExtensions(context.extensionsFor('orders')).persistence),
  }),
  globals: [OrderSettings],
  // Slug, queue and schedule kept as they are: a renamed queue would strand the job already
  // scheduled in production.
  tasks: [
    {
      slug: 'commerce-maintenance',
      retries: 3,
      schedule: [{ cron: '*/5 * * * *', queue: 'commerce' }],
      handler: async ({ req }) => {
        await createOrders(req.payload).maintenance.execute()
        return { output: {} }
      },
    },
  ],
  queues: ['commerce'],
  emailPreviews,
  routes: ['src/app/(frontend)/api/commerce/access/route.ts'],
  files: [
    'src/app/(frontend)/[locale]/commande/acces/page.tsx',
    'src/app/(frontend)/[locale]/commande/suivi/[reference]/page.tsx',
    'src/scripts/commerce-demo.ts',
    'src/scripts/commerce-maintenance.ts',
    'tests/commerce.http.ts',
    'tests/commerce.integration.ts',
    'tests/customer-comment.test.ts',
    'tests/e2e/orders.spec.ts',
    'tests/order-reference.test.ts',
    'tests/orders.adapters.test.ts',
    'tests/orders.application.test.ts',
    'tests/orders.domain.test.ts',
    'tests/orders.ui.test.tsx',
    'tests/support/in-memory-orders.ts',
  ],
}
