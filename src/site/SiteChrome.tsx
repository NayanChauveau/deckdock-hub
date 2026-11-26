import Link from 'next/link'
import type { ReactNode } from 'react'
import { guidePath, publishGuidePath } from '@/core/i18n/guide'
import type { Locale } from '@/core/i18n/locales'
import { legalLabels, legalPath } from '@/core/i18n/legal'
import { ThemeToggle } from '@/core/ui/theme/ThemeToggle'
import { messages } from '@/site/messages'
import { AccountMenu, MobileMenu, SignOutButton } from '@/site/HeaderMenus'
import type { Viewer } from '@/site/viewer'

// No server-only import here: the error page, a client component, renders this frame too.

/** The site's name, as the header, the footer and the homepage's metadata show it. */
export const SITE_NAME = 'DeckDock'

/** Where the header and footer lead, in `locale` (account pages: the accounts and decks modules). */
export function siteLinks(locale: Locale) {
  return {
    home: `/${locale}`,
    catalogue: `/${locale}/decks`,
    publish: publishGuidePath(locale),
    guide: guidePath(locale),
    signIn: `/${locale}/compte/connexion`,
    account: `/${locale}/compte`,
    myDecks: `/${locale}/compte/decks`,
  }
}

/** The homepage in each language: the language switch of pages without a counterpart. */
export const homePaths: Record<Locale, string> = { fr: '/fr', en: '/en' }

const GITHUB = 'https://github.com/NayanChauveau'

interface HeaderProps {
  locale: Locale
  /** The same page in each language, for FR · EN. */
  paths: Record<Locale, string>
  /** Null when unknown (the error page, the maintenance page): no account entry at all. */
  viewer: Viewer | null
  /** Tests only: where signing out goes. */
  navigate?: ((url: string) => void) | undefined
}

/**
 * The header of every public page: « ● DeckDock », Catalogue, Publier un deck, Guide, FR · EN, the
 * theme button, then « Connexion » or the visitor's menu. Under 768 px the links and the account
 * fold into the menu button's panel; FR · EN and the theme button stay in the bar.
 */
export function SiteHeader({ locale, paths, viewer, navigate }: HeaderProps) {
  const t = messages[locale]
  const links = siteLinks(locale)
  const here = paths[locale]
  const current = (href: string, prefix = false) =>
    here === href || (prefix && here.startsWith(`${href}/`) && here !== links.publish)
      ? 'page'
      : undefined
  const navigation = (
    <>
      <Link href={links.catalogue} aria-current={current(links.catalogue)}>
        {t.catalogue}
      </Link>
      <Link href={links.publish} aria-current={current(links.publish)}>
        {t.publish}
      </Link>
      <Link href={links.guide} aria-current={current(links.guide, true)}>
        {t.guide}
      </Link>
    </>
  )
  const accountLinks = viewer?.signedIn && (
    <>
      <Link className="menu-item" href={links.myDecks}>
        {t.myDecks}
      </Link>
      <Link className="menu-item" href={links.account}>
        {t.account}
      </Link>
      <SignOutButton
        href={links.home}
        label={t.signOut}
        failed={t.signOutFailed}
        navigate={navigate}
      />
    </>
  )
  const signIn = viewer && !viewer.signedIn && (
    <Link className="pill-button" href={links.signIn}>
      {t.signIn}
    </Link>
  )
  return (
    <header className="site-header">
      <div className="site-header-bar">
        <Link className="wordmark" href={links.home}>
          <span className="wordmark-dot" aria-hidden="true">
            ●
          </span>
          {SITE_NAME}
        </Link>
        <nav aria-label={t.navigation} className="main-nav">
          {navigation}
        </nav>
        <div className="header-tools">
          <nav className="language-nav" aria-label={t.languages}>
            {/* The accessible name starts with the visible code (WCAG 2.5.3), then the language name. */}
            <Link
              href={paths.fr}
              hrefLang="fr"
              lang="fr"
              aria-current={locale === 'fr' ? 'page' : undefined}
            >
              FR<span className="sr-only"> – Français</span>
            </Link>
            <span aria-hidden="true">·</span>
            <Link
              href={paths.en}
              hrefLang="en"
              lang="en"
              aria-current={locale === 'en' ? 'page' : undefined}
            >
              EN<span className="sr-only"> – English</span>
            </Link>
          </nav>
          <ThemeToggle labels={t.theme} />
          {viewer && (
            <div className="header-account">
              {viewer.signedIn ? (
                <AccountMenu label={viewer.handle ?? t.account} description={t.accountMenu}>
                  {accountLinks}
                </AccountMenu>
              ) : (
                signIn
              )}
            </div>
          )}
          <MobileMenu label={t.menu}>
            <nav aria-label={t.navigation} className="mobile-nav">
              {navigation}
            </nav>
            {viewer?.signedIn && (
              <div className="mobile-account">
                <p className="mobile-account-name">{viewer.handle ?? t.account}</p>
                {accountLinks}
              </div>
            )}
            {signIn && <div className="mobile-account">{signIn}</div>}
          </MobileMenu>
        </div>
      </div>
    </header>
  )
}

/** The footer of every public page: « ● DeckDock · open source », the repositories, guide, legal. */
export function SiteFooter({ locale }: { locale: Locale }) {
  const t = messages[locale]
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p className="footer-brand">
          <span className="wordmark-dot" aria-hidden="true">
            ●
          </span>{' '}
          {SITE_NAME} · {t.openSource}
        </p>
        <nav aria-label={t.footerNavigation} className="footer-links">
          <a href={`${GITHUB}/deckdock`}>{t.githubAddon}</a>
          <a href={`${GITHUB}/deckdock-hub`}>{t.githubHub}</a>
          <Link href={siteLinks(locale).guide}>{t.guide}</Link>
          <Link href={legalPath(locale, 'legalNotice')}>{legalLabels[locale].legalNotice}</Link>
          <Link href={legalPath(locale, 'privacy')}>{legalLabels[locale].privacy}</Link>
        </nav>
      </div>
    </footer>
  )
}

/**
 * Skip link, header, the page in `<main>`, footer: what every public page is drawn in. Server pages
 * use PublicShell, which reads the viewer; the error page and the maintenance page pass `null`.
 */
export function SiteFrame({
  locale,
  paths = homePaths,
  viewer,
  children,
}: {
  locale: Locale
  paths?: Record<Locale, string> | undefined
  viewer: Viewer | null
  children: ReactNode
}) {
  return (
    <div className="site-frame">
      <a className="skip-link" href="#main">
        {messages[locale].skip}
      </a>
      <SiteHeader locale={locale} paths={paths} viewer={viewer} />
      <main id="main" className="site-main">
        {children}
      </main>
      <SiteFooter locale={locale} />
    </div>
  )
}
