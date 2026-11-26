import type { Metadata } from 'next'
import { requestMaintenance } from '@/core/http/maintenance'
import { robots } from '@/core/http/seo'
import { isLocale, type Locale } from '@/core/i18n/locales'
import { messages } from '@/core/i18n/messages'
import { site } from '@/core/site'

export { accountPage } from '@/modules/accounts/ui/page-shell'

/**
 * Private pages, like the account pages: a plain title (never the deck or the visitor's details)
 * and never indexed; the neutral maintenance title while visitors are kept out.
 */
export function authorMetadata(title: (locale: Locale) => string) {
  return async ({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> => {
    const { locale } = await params
    if (!isLocale(locale)) return {}
    const shown = (await requestMaintenance()).visitorBlocked
      ? messages[locale].maintenanceTitle
      : title(locale)
    return { title: `${shown} | ${site.identity.displayName}`, robots: robots(false) }
  }
}
