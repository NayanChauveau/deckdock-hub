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

/** A language's own name, capitalised as it starts a label (`fr` → "Français"), or its code. */
export function languageAutonym(code: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
  } catch {
    return code
  }
}

const MINUTE = 60_000
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * MINUTE],
  ['month', 30 * 24 * 60 * MINUTE],
  ['week', 7 * 24 * 60 * MINUTE],
  ['day', 24 * 60 * MINUTE],
  ['hour', 60 * MINUTE],
  ['minute', MINUTE],
]

/**
 * How long ago `date` was, seen at `now`, in the largest whole unit: « il y a 2 j », "2 days ago"
 * (short style; months and years in full, « il y a 2 mois », since « 2 m. » reads as minutes).
 * `null` under a minute, or for a date ahead of `now`: the caller says « just now ».
 */
export function relativeTime(locale: Locale, date: Date, now: Date): string | null {
  const elapsed = now.getTime() - date.getTime()
  for (const [unit, size] of UNITS) {
    const value = Math.floor(elapsed / size)
    if (value < 1) continue
    const style = unit === 'year' || unit === 'month' ? 'long' : 'short'
    return new Intl.RelativeTimeFormat(locale, { style, numeric: 'always' }).format(-value, unit)
  }
  return null
}
