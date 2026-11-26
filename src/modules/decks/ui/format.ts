import type { Locale } from '@/core/i18n/locales'

/** A date and time as the author reads it (the hub's time zone, Paris). */
export const formatDate = (locale: Locale, date: Date): string =>
  new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Paris',
  }).format(date)

/** A language's name in the reader's language (`fr` → "français"), or its code when unknown. */
export function languageName(locale: Locale, code: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** A day, as the reader reads it (Paris time). */
export const formatDay = (locale: Locale, date: Date): string =>
  new Intl.DateTimeFormat(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    dateStyle: 'long',
    timeZone: 'Europe/Paris',
  }).format(date)
