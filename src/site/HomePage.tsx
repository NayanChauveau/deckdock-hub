import Link from 'next/link'
import type { ReactNode } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { homeContent, TEMPLATE_URL, WORKFLOW_EXCERPT } from '@/site/home-content'
import { siteLinks } from '@/site/SiteChrome'

// Not prefetched, like the header: the guide's pages do not exist yet (SiteChrome.tsx).
const NO_PREFETCH = false

const pill =
  'inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const primary = `${pill} bg-primary text-primary-foreground shadow-[var(--shadow-card)] hover:brightness-110`
const ghost = `${pill} border border-border bg-card text-foreground hover:text-brand`
const container = 'mx-auto w-full max-w-[1120px] px-6'
const tag = 'text-xs font-bold uppercase tracking-[0.08em] text-brand'
const sectionTitle = 'mt-2 text-2xl font-bold tracking-tight text-balance sm:text-3xl'
const card = 'rounded-[var(--radius)] bg-card text-card-foreground shadow-[var(--shadow-card)]'

/**
 * The DeckDock homepage (spec 2026-11-26-refonte-ux, « Accueil »): the hero, how it works, the
 * recent decks (`recent`, drawn by the route from the decks module) and the authors' block.
 */
export function HomePage({ locale, recent }: { locale: Locale; recent: ReactNode }) {
  const t = homeContent[locale]
  const links = siteLinks(locale)
  return (
    <div className="flex flex-col">
      <section aria-labelledby="home-title" className="bg-linear-to-b from-secondary to-background">
        <div className={`${container} flex flex-col items-center pt-14 pb-16 text-center sm:pt-20`}>
          <p className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-brand">
            <span aria-hidden="true">✨ </span>
            {t.badge}
          </p>
          <h1
            id="home-title"
            className="mt-6 max-w-3xl text-4xl leading-[1.08] font-bold tracking-tight text-balance sm:text-6xl"
          >
            {`${t.titleStart} `}
            <br className="hidden sm:inline" />
            <span className="text-gradient">{t.titleEnd}</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted-foreground">{t.lead}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link className={primary} href={links.catalogue}>
              {t.browse}
            </Link>
            <Link className={ghost} href={links.publish} prefetch={NO_PREFETCH}>
              {t.publish}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </section>

      <section aria-labelledby="home-how" className={`${container} py-12 sm:py-14`}>
        <p className={tag}>{t.how.tag}</p>
        <h2 id="home-how" className={sectionTitle}>
          {t.how.title}
        </h2>
        <ol className="mt-8 grid gap-4 md:grid-cols-3">
          {t.how.steps.map((step, index) => (
            <li key={step.title} className={`${card} p-5`}>
              <span
                aria-hidden="true"
                className="flex size-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-brand"
              >
                {index + 1}
              </span>
              <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="home-recent" className={`${container} py-12 sm:py-14`}>
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <p className={tag}>{t.recent.tag}</p>
            <h2 id="home-recent" className={sectionTitle}>
              {t.recent.title}
            </h2>
          </div>
          <Link
            href={links.catalogue}
            className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:underline"
          >
            {t.recent.all}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
        <div className="mt-8">{recent}</div>
      </section>

      <section aria-labelledby="home-authors" className={`${container} py-12 sm:py-14`}>
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div className="min-w-0">
            <p className={tag}>{t.authors.tag}</p>
            <h2 id="home-authors" className={sectionTitle}>
              {t.authors.title}
            </h2>
            <p className="mt-4 text-muted-foreground">{t.authors.text}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link className={primary} href={links.publish} prefetch={NO_PREFETCH}>
                {t.authors.publish}
              </Link>
              <a className={ghost} href={TEMPLATE_URL}>
                {t.authors.template}
                <span aria-hidden="true">→</span>
              </a>
            </div>
          </div>
          <figure className="min-w-0">
            <figcaption className="sr-only">{t.authors.excerpt}</figcaption>
            <pre className="rounded-[var(--radius)] bg-code p-5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-code-foreground shadow-[var(--shadow-card)]">
              <code>{WORKFLOW_EXCERPT}</code>
            </pre>
          </figure>
        </div>
      </section>
    </div>
  )
}

/** « Decks récents » while no deck is approved: an invitation to publish the first one. */
export function RecentDecksEmpty({ locale }: { locale: Locale }) {
  const t = homeContent[locale].recent
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius)] border border-dashed border-border bg-card px-6 py-10 text-center">
      <h3 className="text-lg font-semibold">{t.emptyTitle}</h3>
      <p className="max-w-md text-sm text-muted-foreground">{t.emptyText}</p>
      <Link className={`${primary} mt-2`} href={siteLinks(locale).publish} prefetch={NO_PREFETCH}>
        {t.emptyAction}
      </Link>
    </div>
  )
}
