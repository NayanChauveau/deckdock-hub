import type { SiteModule } from '@/core/modules/types'
import { accountsModule } from './accounts/module'
import { decksModule } from './decks/module'

/**
 * The modules of this site: one line each. Removing a line (and its folder) removes the module.
 * Kept on several lines even with one module: scripts/remove-module.mjs removes a whole line.
 */
// prettier-ignore
export const modules: readonly SiteModule[] = [
  accountsModule,
  decksModule,
]
