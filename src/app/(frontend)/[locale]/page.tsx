import { MaintenancePage } from '@/core/ui/Maintenance'
import { maintenanceMetadata, requestMaintenance } from '@/core/http/maintenance'
import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { isLocale } from '@/core/i18n/locales'
import { messages } from '@/site/messages'
import { getSiteData } from '@/site/site-data'
import { alternates, mediaURL, robots, sharingMetadata } from '@/core/http/seo'
import { SiteFooter, SiteHeader } from '@/site/SiteChrome'
import { site } from '@/core/site'
import { siteMessages } from '@/site/messages'

export const dynamic = 'force-dynamic'
interface Props {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  const closed = await maintenanceMetadata(locale, siteMessages[locale].maintenanceText)
  if (closed) return closed
  try {
    const { content, settings } = await getSiteData(locale)
    const siteName = settings.siteName || site.identity.displayName
    const title = `${content.seoTitle?.trim() || content.title || messages[locale].fallbackTitle} | ${siteName}`
    const description = content.seoDescription?.trim() || content.description || undefined
    return {
      title,
      description,
      alternates: alternates(locale, { fr: '/fr', en: '/en' }),
      robots: robots(true),
      ...sharingMetadata({
        locale,
        path: `/${locale}`,
        siteName,
        title,
        description,
        images: [content.seoImage, content.heroImage],
      }),
    }
  } catch {
    return { title: site.identity.displayName, robots: robots(false) }
  }
}

/** Placeholder homepage: the site's title, introduction and main image from the administration. */
export default async function Home({ params }: Props) {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  // Rendered in parallel with the layout: the page itself must not render real content for visitors.
  if ((await requestMaintenance()).visitorBlocked)
    return <MaintenancePage locale={locale} text={siteMessages[locale].maintenanceText} />
  const t = messages[locale]
  const { content, settings } = await getSiteData(locale)
  const name = settings.siteName || site.identity.displayName
  const image =
    content.heroImage && typeof content.heroImage === 'object' ? content.heroImage : null
  const imageURL = image?.filename ? mediaURL(image.filename) : null
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        {t.skip}
      </a>
      <SiteHeader locale={locale} name={name} anchors />
      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">{t.eyebrow}</p>
            <h1 id="hero-title">{content.title || t.fallbackTitle}</h1>
            <p className="hero-description whitespace-pre-line">
              {content.description || t.fallbackDescription}
            </p>
            <a className="text-link" href="#about">
              {t.discover}
              <span aria-hidden="true">↘</span>
            </a>
          </div>
          <figure className="hero-art">
            {imageURL ? (
              <Image
                src={imageURL}
                alt={image?.alt || ''}
                width={image?.width ?? 900}
                height={image?.height ?? 1100}
                sizes="(max-width: 760px) 90vw, 45vw"
                className="hero-image"
                unoptimized
              />
            ) : (
              <div className="art-placeholder">
                <p>{t.imagePlaceholder}</p>
              </div>
            )}
          </figure>
        </section>
        <section id="about" className="about-section" aria-labelledby="about-title">
          <p className="eyebrow">{t.about}</p>
          <h2 id="about-title">{t.aboutTitle}</h2>
          <p>{t.aboutText}</p>
        </section>
      </main>
      <SiteFooter locale={locale} name={name} text={settings.footerText} />
    </div>
  )
}
