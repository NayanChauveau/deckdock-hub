import * as migration_20261119_130809_initial from './20261119_130809_initial'
import * as migration_20261125_103611_delivery_countries from './20261125_103611_delivery_countries'
import * as migration_20261125_150000_accounts_auth_schema from './20261125_150000_accounts_auth_schema'
import * as migration_20261125_151000_accounts_customers from './20261125_151000_accounts_customers'
import * as migration_20261125_152000_accounts_orphan_sweep from './20261125_152000_accounts_orphan_sweep'
import * as migration_20261125_221655_retrait_orders_payments_stripe_addresses_customer_uploads from './20261125_221655_retrait_orders_payments_stripe_addresses_customer_uploads'
import * as migration_20261125_224245_decks from './20261125_224245_decks'
import * as migration_20261126_005922_versions_preview from './20261126_005922_versions_preview'

export const migrations = [
  {
    up: migration_20261119_130809_initial.up,
    down: migration_20261119_130809_initial.down,
    name: '20261119_130809_initial',
  },
  {
    up: migration_20261125_103611_delivery_countries.up,
    down: migration_20261125_103611_delivery_countries.down,
    name: '20261125_103611_delivery_countries',
  },
  {
    up: migration_20261125_150000_accounts_auth_schema.up,
    down: migration_20261125_150000_accounts_auth_schema.down,
    name: '20261125_150000_accounts_auth_schema',
  },
  {
    up: migration_20261125_151000_accounts_customers.up,
    down: migration_20261125_151000_accounts_customers.down,
    name: '20261125_151000_accounts_customers',
  },
  {
    up: migration_20261125_152000_accounts_orphan_sweep.up,
    down: migration_20261125_152000_accounts_orphan_sweep.down,
    name: '20261125_152000_accounts_orphan_sweep',
  },
  {
    up: migration_20261125_221655_retrait_orders_payments_stripe_addresses_customer_uploads.up,
    down: migration_20261125_221655_retrait_orders_payments_stripe_addresses_customer_uploads.down,
    name: '20261125_221655_retrait_orders_payments_stripe_addresses_customer_uploads',
  },
  {
    up: migration_20261125_224245_decks.up,
    down: migration_20261125_224245_decks.down,
    name: '20261125_224245_decks',
  },
  {
    up: migration_20261126_005922_versions_preview.up,
    down: migration_20261126_005922_versions_preview.down,
    name: '20261126_005922_versions_preview',
  },
]
