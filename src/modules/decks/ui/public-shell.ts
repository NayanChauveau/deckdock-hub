import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { requestMaintenance } from '@/core/http/maintenance'
import { alternates, robots } from '@/core/http/seo'
import { isLocale, type Locale } from '@/core/i18n/locales'
import { messages } from '@/core/i18n/messages'
import { site } from '@/core/site'

/** One `searchParams` value as a single string (the first when repeated), or undefined. */
export const param = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

/**
 * A public page of a known language. While visitors are kept out, the `[locale]` layout shows the
 * maintenance page in its place: nothing here runs and no deck is read.
 */
export async function publicPage(
  locale: string,
  render: (locale: Locale) => Promise<ReactNode> | ReactNode,
): Promise<ReactNode> {
  if (!isLocale(locale)) notFound()
  if ((await requestMaintenance()).visitorBlocked) return null
  return render(locale)
}

interface PageMetadata {
  title: string
  description?: string
  paths?: Record<Locale, string>
  indexable: boolean
}

/**
 * Metadata of a public page: indexable when `indexable` (and PUBLIC_INDEXING allows it), with its
 * French and English addresses; the neutral maintenance title while visitors are kept out.
 */
export async function publicMetadata(
  locale: string,
  page: (locale: Locale) => PageMetadata | Promise<PageMetadata>,
): Promise<Metadata> {
  if (!isLocale(locale)) return {}
  if ((await requestMaintenance()).visitorBlocked)
    return {
      title: `${messages[locale].maintenanceTitle} | ${site.identity.displayName}`,
      robots: robots(false),
    }
  const { title, description, paths, indexable } = await page(locale)
  return {
    title: `${title} | ${site.identity.displayName}`,
    ...(description ? { description } : {}),
    ...(paths ? { alternates: alternates(locale, paths) } : {}),
    robots: robots(indexable),
  }
}
