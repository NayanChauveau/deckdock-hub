import { ordersSettings } from './settings'
import type { Language } from './domain/value-objects'

/** Public URLs of an order are the site's, so they come from site.config.json. */
export const trackingPath = (locale: Language, reference: string) =>
  ordersSettings.trackingPath.replace('{locale}', locale).replace('{reference}', reference)
export const accessPath = (locale: Language) =>
  ordersSettings.accessPath.replace('{locale}', locale)

/**
 * Return addresses of the payment page: `paid=1` lets the tracking page report the purchase once
 * to the audience measurement (src/core/http/analytics.ts), `cancelled=1` offers to pay again.
 */
export const checkoutReturn = (locale: Language, reference: string) => {
  const path = trackingPath(locale, reference)
  return { success: `${path}?paid=1`, cancel: `${path}?cancelled=1` }
}
