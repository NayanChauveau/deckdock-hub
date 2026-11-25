import type { Locale } from '@/core/i18n/locales'
import { messages } from '@/core/i18n/messages'
import { site } from '@/core/site'

/**
 * Shown to visitors instead of every public page while the site is in maintenance; `text` is the
 * site's own message.
 */
export function MaintenancePage({ locale, text }: { locale: Locale; text: string }) {
  const t = messages[locale]
  return (
    <main className="state-screen">
      <p className="eyebrow">{site.identity.displayName}</p>
      <h1>{t.maintenanceTitle}</h1>
      <p>{text}</p>
    </main>
  )
}

/** Reminder for signed-in administrators: they see the real site, visitors do not. */
export function MaintenanceBanner({ locale }: { locale: Locale }) {
  return (
    <p className="maintenance-banner" role="status">
      {messages[locale].maintenanceBanner}
    </p>
  )
}
