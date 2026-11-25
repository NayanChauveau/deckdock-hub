import type { Metadata } from 'next'
import type { Locale } from '@/core/i18n/locales'
import type { Media } from '@/payload-types'
import { devOrigin } from '@/core/site'

export const mediaURL = (filename: string) => `/api/media/file/${encodeURIComponent(filename)}`

export function sharingMetadata({
  locale,
  path,
  siteName,
  title,
  description,
  images,
}: {
  locale: Locale
  path: string
  siteName: string
  title: string
  description: string | undefined
  images: (Media | number | null | undefined)[]
}): Pick<Metadata, 'openGraph' | 'twitter'> {
  const image = images.find((value): value is Media =>
    Boolean(value && typeof value === 'object' && value.filename),
  )
  const sharedImages = image?.filename
    ? [
        {
          url: mediaURL(image.filename),
          width: image.width ?? undefined,
          height: image.height ?? undefined,
          alt: image.alt || undefined,
        },
      ]
    : undefined
  return {
    openGraph: {
      type: 'website',
      locale: locale === 'fr' ? 'fr_FR' : 'en_GB',
      alternateLocale: locale === 'fr' ? 'en_GB' : 'fr_FR',
      url: path,
      siteName,
      title,
      description,
      images: sharedImages,
    },
    twitter: {
      card: sharedImages ? 'summary_large_image' : 'summary',
      title,
      description,
      images: sharedImages,
    },
  }
}

/** Public origin, identical to the one Payload validates at startup. */
export function siteURL(): URL {
  return new URL(process.env['APP_URL'] || devOrigin)
}

/**
 * Indexing is opt-in through PUBLIC_INDEXING=true, set by the deployment once the shop opens.
 * Order tracking, admin and API routes stay out of search engines regardless.
 */
export function publicIndexing(): boolean {
  return process.env['PUBLIC_INDEXING'] === 'true'
}

export function robots(indexable: boolean): NonNullable<Metadata['robots']> {
  return indexable && publicIndexing()
    ? { index: true, follow: true }
    : { index: false, follow: false }
}

/** Canonical URL of the current language and reciprocal hreflang links, x-default to French. */
export function alternates(
  locale: Locale,
  paths: Record<Locale, string>,
): NonNullable<Metadata['alternates']> {
  return {
    canonical: paths[locale],
    languages: { fr: paths.fr, en: paths.en, 'x-default': paths.fr },
  }
}
