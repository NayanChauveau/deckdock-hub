import type { Locale } from './locales'

export const legalPageKeys = ['legalNotice', 'terms', 'privacy'] as const
export type LegalPageKey = (typeof legalPageKeys)[number]

/** Public URL segment of each legal page, per language. */
export const legalSlugs: Record<Locale, Record<LegalPageKey, string>> = {
  fr: {
    legalNotice: 'mentions-legales',
    terms: 'conditions-generales-de-vente',
    privacy: 'confidentialite',
  },
  en: { legalNotice: 'legal-notice', terms: 'terms-of-sale', privacy: 'privacy' },
}

export const legalLabels: Record<Locale, Record<LegalPageKey, string>> = {
  fr: {
    legalNotice: 'Mentions légales',
    terms: 'Conditions générales de vente',
    privacy: 'Confidentialité',
  },
  en: { legalNotice: 'Legal notice', terms: 'Terms of sale', privacy: 'Privacy' },
}

export function legalPath(locale: Locale, key: LegalPageKey): string {
  return `/${locale}/${legalSlugs[locale][key]}`
}

export function legalPageFromSlug(locale: Locale, slug: string): LegalPageKey | null {
  return legalPageKeys.find((key) => legalSlugs[locale][key] === slug) ?? null
}
