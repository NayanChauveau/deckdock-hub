import { site, type SiteConfig } from '@/core/site'

/** The orders module's settings (site.config.json `modules.orders`), required while it is installed. */
export function ordersSettingsOf(config: Pick<SiteConfig, 'modules'>) {
  if (!config.modules.orders)
    throw new Error('site.config.json : modules.orders est requis par le module orders.')
  return config.modules.orders
}

export const ordersSettings = ordersSettingsOf(site)
