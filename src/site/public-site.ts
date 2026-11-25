import type { Payload } from 'payload'
import type { Locale } from '@/core/i18n/locales'

// No privileged reads or application cache: every request sees saved CMS content.
export async function readPublicSite(payload: Payload, locale: Locale) {
  const options = { locale, fallbackLocale: 'fr' as const, overrideAccess: false }
  const [content, settings] = await Promise.all([
    payload.findGlobal({ ...options, slug: 'site-content', depth: 1 }),
    payload.findGlobal({ ...options, slug: 'site-settings', depth: 1 }),
  ])
  return { content, settings }
}

export async function readLegalPages(payload: Payload, locale: Locale) {
  return payload.findGlobal({
    slug: 'legal-pages',
    locale,
    fallbackLocale: 'fr',
    overrideAccess: false,
    depth: 0,
  })
}
