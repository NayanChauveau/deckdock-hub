import type { Locale } from '@/core/i18n/locales'

/** A date and time as the author reads it (the hub's time zone, Paris). */
export const formatDate = (locale: Locale, date: Date): string =>
  new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(date)
