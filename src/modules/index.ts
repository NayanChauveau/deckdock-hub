import type { SiteModule } from '@/core/modules/types'
import { accountsModule } from './accounts/module'
import { addressesModule } from './addresses/module'
import { customerUploadsModule } from './customer-uploads/module'
import { ordersModule } from './orders/module'
import { paymentsStripeModule } from './payments-stripe/module'

/** The modules of this site: one line each. Removing a line (and its folder) removes the module. */
export const modules: readonly SiteModule[] = [
  accountsModule,
  addressesModule,
  ordersModule,
  paymentsStripeModule,
  customerUploadsModule,
]
