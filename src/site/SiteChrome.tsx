import Link from 'next/link'
import type { Locale } from '@/core/i18n/locales'
import { messages } from '@/site/messages'
import { legalLabels, legalPageKeys, legalPath } from '@/core/i18n/legal'
import { ThemeToggle } from '@/core/ui/theme/ThemeToggle'

interface HeaderProps {
  locale: Locale
  name: string
  paths?: Record<Locale, string>
  anchors?: boolean
}

/** Shared header. `paths` points the language switch to the same page in each language. */
export function SiteHeader({
  locale,
  name,
  paths = { fr: '/fr', en: '/en' },
  anchors = false,
}: HeaderProps) {
  const t = messages[locale]
  return (
    <header className="site-header">
      <Link className="wordmark" href={`/${locale}`}>
        {name}
        <span>{t.eyebrow}</span>
      </Link>
      <nav aria-label={t.navigation} className="main-nav">
        <Link href={anchors ? '#about' : `/${locale}#about`}>{t.about}</Link>
      </nav>
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
        <span aria-hidden="true">/</span>
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
    </header>
  )
}

export function SiteFooter({
  locale,
  name,
  text,
}: {
  locale: Locale
  name: string
  text?: string | null | undefined
}) {
  const t = messages[locale]
  return (
    <footer className="site-footer">
      <span className="footer-name">{name}</span>
      <p>{text || t.footer}</p>
      <nav aria-label={t.legalNavigation} className="footer-legal">
        {legalPageKeys.map((key) => (
          <Link key={key} href={legalPath(locale, key)}>
            {legalLabels[locale][key]}
          </Link>
        ))}
      </nav>
      <span>© {new Date().getFullYear()}</span>
    </footer>
  )
}
