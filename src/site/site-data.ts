import { cache } from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { Locale } from '@/core/i18n/locales'
import { readLegalPages, readPublicSite } from './public-site'

// React cache deduplicates metadata/page reads within a render, not between requests.
export const getSiteData = cache(async (locale: Locale) => {
  const payload = await getPayload({ config })
  return readPublicSite(payload, locale)
})

export const getLegalPages = cache(async (locale: Locale) => {
  const payload = await getPayload({ config })
  return readLegalPages(payload, locale)
})
