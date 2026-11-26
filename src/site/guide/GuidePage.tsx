import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guidePath } from '@/core/i18n/guide'
import { isLocale, type Locale } from '@/core/i18n/locales'
import { alternates, robots } from '@/core/http/seo'
import { maintenanceMetadata } from '@/core/http/maintenance'
import { site } from '@/core/site'
import { siteMessages } from '@/site/messages'
import { decodeSegment, PublicShell } from '@/site/PublicShell'
import { GuideCopy } from './GuideCopy'
import { guidePage, guidePages } from './load'

export const guideMessages = {
  fr: {
    title: 'Guide des auteurs',
    lead: 'Tout pour publier un deck sur DeckDock, même si vous n’avez jamais codé : comment ça marche, la publication pas à pas depuis GitHub, l’envoi sans GitHub et le format en détail.',
    contents: 'Sommaire du guide',
    home: 'Accueil du guide',
    start: 'Commencer par le début',
    pager: 'Pages précédente et suivante',
    previous: 'Page précédente',
    next: 'Page suivante',
    copy: 'Copier',
    copied: 'Copié',
    copyFailed: 'Copie impossible : sélectionnez le texte',
  },
  en: {
    title: 'Author guide',
    lead: 'Everything you need to publish a deck on DeckDock, even if you have never written code: how it works, publishing step by step from GitHub, sending without GitHub, and the format in detail.',
    contents: 'Guide contents',
    home: 'Guide home',
    start: 'Start at the beginning',
    pager: 'Previous and next pages',
    previous: 'Previous page',
    next: 'Next page',
    copy: 'Copy',
    copied: 'Copied',
    copyFailed: 'Copy failed: select the text',
  },
} as const

interface Props {
  params: Promise<{ locale: string; slug?: string[] | undefined }>
}

type Resolved =
  | { kind: 'home'; locale: Locale; paths: Record<Locale, string> }
  | {
      kind: 'page'
      locale: Locale
      slug: string
      page: NonNullable<ReturnType<typeof guidePage>>
      paths: Record<Locale, string>
    }

/** `/{locale}/guide` is the guide's home, `/{locale}/guide/<slug>` one of its pages; nothing else. */
async function resolve(params: Props['params']): Promise<Resolved | null> {
  const { locale, slug = [] } = await params
  if (!isLocale(locale) || slug.length > 1) return null
  const other: Locale = locale === 'fr' ? 'en' : 'fr'
  if (slug.length === 0)
    return { kind: 'home', locale, paths: { fr: guidePath('fr'), en: guidePath('en') } }
  const current = decodeSegment(slug[0] ?? '')
  const page = guidePage(locale, current)
  if (!page) return null
  const paths = { [locale]: guidePath(locale, current), [other]: guidePath(other, page.other) }
  return { kind: 'page', locale, slug: current, page, paths: paths as Record<Locale, string> }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await resolve(params).catch(() => null)
  if (!resolved) return { robots: robots(false) }
  const { locale } = resolved
  const closed = await maintenanceMetadata(locale, siteMessages[locale].maintenanceText)
  if (closed) return closed
  const t = guideMessages[locale]
  const entry =
    resolved.kind === 'page' ? guidePages(locale).find((p) => p.slug === resolved.slug) : null
  return {
    title: `${entry ? `${entry.title} · ${t.title}` : t.title} | ${site.identity.displayName}`,
    description: entry?.summary ?? t.lead,
    alternates: alternates(locale, resolved.paths),
    robots: robots(true),
  }
}

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const item = `flex min-h-10 items-center rounded-lg px-3 py-2 text-sm ${focus}`
const itemOn = `${item} bg-secondary font-semibold text-brand`
const itemOff = `${item} text-muted-foreground hover:bg-muted hover:text-foreground`
const card = 'rounded-[var(--radius)] bg-card text-card-foreground shadow-[var(--shadow-card)]'

/** The guide (spec 2026-11-26-refonte-ux, « Guide »): its table of contents beside the page. */
export default async function GuideRoute({ params }: Props) {
  const resolved = await resolve(params)
  if (!resolved) notFound()
  const { locale } = resolved
  const t = guideMessages[locale]
  const pages = guidePages(locale)
  const index = resolved.kind === 'page' ? pages.findIndex((p) => p.slug === resolved.slug) : -1
  const previous = index > 0 ? pages[index - 1] : undefined
  const next = resolved.kind === 'home' ? pages[0] : pages[index + 1]
  const links = [
    { href: guidePath(locale), title: t.home, current: resolved.kind === 'home' },
    ...pages.map((page, i) => ({
      href: guidePath(locale, page.slug),
      title: page.title,
      current: i === index,
    })),
  ]
  return (
    <PublicShell locale={locale} paths={resolved.paths}>
      <div className="mx-auto grid w-full max-w-[1120px] min-w-0 grid-cols-1 gap-6 px-4 py-8 sm:px-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-12 md:py-12">
        <nav aria-label={t.contents} className="min-w-0">
          <ol className="flex flex-col gap-1 rounded-[var(--radius)] border border-border p-2 md:sticky md:top-6 md:border-0 md:p-0">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={link.current ? 'page' : undefined}
                  className={link.current ? itemOn : itemOff}
                >
                  {link.title}
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <article className="min-w-0">
          {resolved.kind === 'home' ? (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                {t.title}
              </h1>
              <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t.lead}</p>
              <ol className="mt-8 grid gap-4 sm:grid-cols-2">
                {pages.map((page, i) => (
                  <li key={page.slug} className={`${card} relative p-5`}>
                    <span
                      aria-hidden="true"
                      className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-brand"
                    >
                      {i + 1}
                    </span>
                    <h2 className="mt-4 text-base font-semibold">
                      <Link
                        href={guidePath(locale, page.slug)}
                        className={`after:absolute after:inset-0 after:rounded-[var(--radius)] hover:text-brand ${focus}`}
                      >
                        {page.title}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">{page.summary}</p>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <>
              <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">
                {resolved.page.title}
              </h1>
              <GuideCopy labels={{ copy: t.copy, copied: t.copied, failed: t.copyFailed }}>
                <div
                  className="guide-prose"
                  // The guide's own Markdown, raw HTML escaped by the renderer (render.ts).
                  dangerouslySetInnerHTML={{ __html: resolved.page.html }}
                />
              </GuideCopy>
            </>
          )}
          {(previous ?? next) && (
            <nav
              aria-label={t.pager}
              className="mt-12 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:justify-between"
            >
              {previous ? (
                <Link href={guidePath(locale, previous.slug)} className={`${card} p-4 ${focus}`}>
                  <span className="block text-xs text-muted-foreground">{t.previous}</span>
                  <span className="font-semibold">
                    <span aria-hidden="true">← </span>
                    {previous.title}
                  </span>
                </Link>
              ) : (
                <span />
              )}
              {next && (
                <Link
                  href={guidePath(locale, next.slug)}
                  className={`${card} p-4 text-right ${focus}`}
                >
                  <span className="block text-xs text-muted-foreground">
                    {resolved.kind === 'home' ? t.start : t.next}
                  </span>
                  <span className="font-semibold">
                    {next.title}
                    <span aria-hidden="true"> →</span>
                  </span>
                </Link>
              )}
            </nav>
          )}
        </article>
      </div>
    </PublicShell>
  )
}
