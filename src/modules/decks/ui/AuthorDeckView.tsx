import Link from 'next/link'
import type { Locale } from '@/core/i18n/locales'
import type { AuthorDeckSummary } from '../application/author-space'
import type { Deck, EditionHistory } from '../domain/model'
import { deckMessages } from '../messages'
import { authorSpacePath, publishGuidePath } from '../paths'
import { CopyField } from './components/CopyField'
import { DeckIcon } from './components/DeckIcon'
import { Section } from './components/Section'
import { StatusBadge } from './components/StatusBadge'
import { DeckEditions } from './DeckEditions'
import { formatDate } from './format'
import type { RevokeResult, TokenResult } from './results'
import { TokenPanel } from './TokenPanel'

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const inlineLink = `font-medium text-brand underline-offset-2 hover:underline ${focus}`
const code = 'rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] wrap-anywhere'

/**
 * One deck of the author (spec 2026-11-26-refonte-ux, « Détail d'un deck »): breadcrumb, icon, name
 * and status (a hidden deck's reason with it). Until a first version is received, the 3-step guide
 * (the `DECKDOCK_TOKEN` secret, the `DECKDOCK_HUB_URL` variable with the hub's address to copy, the
 * push), then the editions with their addresses and versions, and the token (regenerate, revoke).
 * Once a version is in, a short CI reminder takes the guide's place, after the token.
 */
export function AuthorDeckView({
  locale,
  origin,
  handle,
  deck,
  summary,
  editions,
  regenerate,
  revoke,
}: {
  locale: Locale
  /** The hub's public address: `DECKDOCK_HUB_URL` and the editions' addresses. */
  origin: string
  handle: string
  deck: Deck
  summary: AuthorDeckSummary
  editions: readonly EditionHistory[]
  regenerate: (deckId: string) => Promise<TokenResult>
  revoke: (deckId: string) => Promise<RevokeResult>
}) {
  const messages = deckMessages[locale]
  const t = messages.deck
  const steps = t.guideSteps
  const received = editions.some((edition) => edition.versions.length > 0)
  const guideLink = (
    <p className="text-sm">
      <Link href={publishGuidePath(locale)} prefetch={false} className={inlineLink}>
        {t.guideLink}
      </Link>
    </p>
  )
  return (
    <>
      <nav aria-label={t.breadcrumb}>
        <ol className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
          <li className="shrink-0">
            <Link href={authorSpacePath(locale)} className={`hover:text-brand ${focus}`}>
              {messages.space.title}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="min-w-0 truncate text-foreground">
            {summary.name}
          </li>
        </ol>
      </nav>

      <header className="flex min-w-0 items-center gap-4">
        <DeckIcon icon={summary.icon} name={summary.name} deckId={deck.deckId} size="lg" />
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <h1 className="text-2xl font-bold tracking-tight wrap-anywhere sm:text-3xl">
            {summary.name}
          </h1>
          {summary.name !== deck.deckId && (
            <p className="font-mono text-xs wrap-anywhere text-muted-foreground">{deck.deckId}</p>
          )}
          <StatusBadge
            status={deck.status}
            label={messages.status[deck.status]}
            reason={deck.hiddenReason}
            reasonLabel={t.hiddenReason}
            testId="deck-status"
          />
        </div>
      </header>
      <p className="max-w-prose text-sm text-muted-foreground">{t.statusHelp[deck.status]}</p>

      {!received && (
        <Section id="deck-guide" title={t.guideTitle} className="border border-primary/40">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t.guideIntro}</p>
            <ol className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
              <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-border p-4 text-sm">
                <h3 className="font-semibold">1 · {steps.token.title}</h3>
                <p className="text-muted-foreground">
                  {steps.token.before} <code className={code}>DECKDOCK_TOKEN</code>{' '}
                  {steps.token.after}
                </p>
                <p>
                  <a href="#deck-token" className={inlineLink}>
                    {steps.token.link}
                  </a>
                </p>
              </li>
              <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-border p-4 text-sm">
                <h3 className="font-semibold">2 · {steps.address.title}</h3>
                <p className="text-muted-foreground">
                  {steps.address.before} <code className={code}>DECKDOCK_HUB_URL</code>{' '}
                  {steps.address.after}
                </p>
                <CopyField
                  key={origin}
                  label={steps.address.label}
                  value={origin}
                  testId="hub-url"
                  copy={messages.token.copy}
                  copied={messages.token.copied}
                  failed={messages.token.copyFailed}
                />
              </li>
              <li className="flex min-w-0 flex-col gap-2 rounded-xl border border-dashed border-border p-4 text-sm">
                <h3 className="font-semibold">3 · {steps.push.title}</h3>
                <p className="text-muted-foreground">{steps.push.text}</p>
              </li>
            </ol>
            {guideLink}
          </div>
        </Section>
      )}

      <DeckEditions
        locale={locale}
        origin={origin}
        handle={handle}
        deckId={deck.deckId}
        editions={editions}
      />

      <Section id="deck-token" title={messages.token.title}>
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-muted-foreground">{messages.token.intro}</p>
          <p>
            {deck.tokenLastUsedAt
              ? t.lastUsed(formatDate(locale, deck.tokenLastUsedAt))
              : t.neverUsed}
          </p>
          <TokenPanel
            locale={locale}
            deckId={deck.deckId}
            regenerate={regenerate}
            revoke={revoke}
          />
        </div>
      </Section>

      {received && (
        <Section id="deck-ci" title={t.ciTitle}>
          <div className="flex flex-col gap-4 text-sm">
            <p className="text-muted-foreground">{t.ciIntro}</p>
            <dl className="flex flex-col gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="font-medium">
                  {t.ciSecret} <code className={code}>DECKDOCK_TOKEN</code>
                </dt>
                <dd className="text-muted-foreground">{t.ciSecretValue}</dd>
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <dt className="font-medium">
                  {t.ciVariable} <code className={code}>DECKDOCK_HUB_URL</code>
                </dt>
                <dd>
                  <code className="font-mono break-all">{origin}</code>
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground">{t.ciOutro}</p>
            {guideLink}
          </div>
        </Section>
      )}
    </>
  )
}
