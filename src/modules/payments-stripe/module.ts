import type { SiteModule } from '@/core/modules/types'
import { paymentGateway } from './configuration'

const api = 'src/app/(frontend)/api/commerce'

/** Card payments through Stripe Checkout, for the generic orders. */
export const paymentsStripeModule: SiteModule = {
  name: 'payments-stripe',
  dependsOn: ['orders'],
  extensions: { orders: { payments: paymentGateway } },
  routes: ['webhook', 'retry', 'simulate'].map((name) => `${api}/${name}/route.ts`),
  files: ['tests/payments-stripe.test.ts'],
}
