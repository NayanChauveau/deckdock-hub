import Link from 'next/link'
import type { ReactNode } from 'react'
import { BookOpenIcon, LayersIcon, UserRoundIcon } from 'lucide-react'
import type { Locale } from '@/core/i18n/locales'
import { accountPath } from '@/modules/accounts/paths'
import { deckMessages } from '../messages'
import { authorSpacePath, guidePath } from '../paths'

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const item = `inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm whitespace-nowrap ${focus}`
const itemOn = `${item} bg-secondary font-semibold text-brand`
const itemOff = `${item} text-muted-foreground hover:bg-muted hover:text-foreground`

/**
 * The author space's frame (spec 2026-11-26-refonte-ux, « Espace auteur »): a sidebar (Mes decks,
 * Compte, Guide auteur) beside the page; under 768 px, the same links as tabs above it.
 */
export function AuthorShell({
  locale,
  current,
  children,
}: {
  locale: Locale
  current: 'decks'
  children: ReactNode
}) {
  const t = deckMessages[locale].space
  const links = [
    { key: 'decks', href: authorSpacePath(locale), label: t.nav.decks, Icon: LayersIcon },
    { key: 'account', href: accountPath(locale), label: t.nav.account, Icon: UserRoundIcon },
    { key: 'guide', href: guidePath(locale), label: t.nav.guide, Icon: BookOpenIcon },
  ] as const
  return (
    <div className="mx-auto grid w-full max-w-[1120px] min-w-0 grid-cols-1 gap-6 px-4 py-6 sm:px-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-10 md:py-10">
      <nav aria-label={t.navLabel} className="min-w-0">
        <ul className="flex gap-1 overflow-x-auto border-b border-border pb-2 md:sticky md:top-6 md:flex-col md:overflow-visible md:border-r md:border-b-0 md:pr-4 md:pb-0">
          {links.map(({ key, href, label, Icon }) => (
            <li key={key}>
              <Link
                href={href}
                aria-current={key === current ? 'page' : undefined}
                className={key === current ? itemOn : itemOff}
              >
                <Icon aria-hidden="true" size={16} />
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </div>
  )
}
