import Link from 'next/link'
import type { Locale } from '@/core/i18n/locales'
import type { AuthorDeckSummary } from '../application/author-space'
import { deckMessages } from '../messages'
import { authorDeckPath } from '../paths'
import { DeckIcon } from './components/DeckIcon'
import { Section } from './components/Section'
import { StatusBadge } from './components/StatusBadge'
import { HandleForm } from './HandleForm'
import { NewDeckForm } from './NewDeckForm'
import type { CreateDeckResult, HandleResult } from './results'

const focus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'
const primary = `inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-card)] transition hover:brightness-110 ${focus}`

/** A small line of parts, « · » between them for the eye, a comma for assistive technologies. */
function Parts({ parts }: { parts: readonly string[] }) {
  return parts.map((part, index) => (
    <span key={`${String(index)}-${part}`}>
      {index > 0 && (
        <>
          <span aria-hidden="true"> · </span>
          <span className="sr-only">, </span>
        </>
      )}
      {part}
    </span>
  ))
}

/**
 * « Mes decks » (spec 2026-11-26-refonte-ux): the handle to choose first; then the author's decks
 * (icon or initial, name, identifier, editions, last version, status pill with a hidden deck's
 * reason), « + Nouveau deck » and the form it leads to.
 */
export function AuthorDecksView({
  locale,
  handle,
  decks,
  chooseHandle,
  createDeck,
}: {
  locale: Locale
  /** The author's handle, or null before it is chosen. */
  handle: string | null
  decks: readonly AuthorDeckSummary[]
  chooseHandle: (handle: string) => Promise<HandleResult>
  createDeck: (deckId: string) => Promise<CreateDeckResult>
}) {
  const messages = deckMessages[locale]
  const t = messages.space
  return (
    <>
      <header className="flex min-w-0 flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h1>
        {handle && (
          <a href="#deck-new" className={primary}>
            {t.newDeck}
          </a>
        )}
      </header>
      <p className="max-w-prose text-sm text-muted-foreground">{t.intro}</p>
      {handle ? (
        <>
          <p className="text-sm wrap-anywhere">
            {t.handleIs} <strong className="font-semibold">{handle}</strong>
          </p>
          <Section id="decks-list" title={t.decksTitle}>
            {decks.length ? (
              <ul className="-my-1 flex flex-col divide-y divide-border">
                {decks.map((summary) => {
                  const { deck } = summary
                  const meta = [
                    deck.deckId,
                    ...(summary.editions.length ? [summary.editions.join(', ')] : []),
                    summary.version ? t.lastVersion(summary.version) : t.noVersion,
                  ]
                  return (
                    <li key={deck.id} className="flex min-w-0 flex-wrap items-center gap-3 py-3">
                      <DeckIcon icon={summary.icon} name={summary.name} deckId={deck.deckId} />
                      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
                        <Link
                          href={authorDeckPath(locale, deck.deckId)}
                          className={`font-semibold wrap-anywhere hover:text-brand ${focus}`}
                        >
                          {summary.name}
                        </Link>
                        <p className="text-xs wrap-anywhere text-muted-foreground">
                          <Parts parts={meta} />
                        </p>
                      </div>
                      {/* Under the name on a phone, at the end of the row on a wider screen. */}
                      <div className="flex min-w-0 basis-full pl-[52px] sm:ml-auto sm:max-w-[45%] sm:basis-auto sm:justify-end sm:pl-0">
                        <Status locale={locale} summary={summary} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{t.noDecks}</p>
            )}
          </Section>
          <Section id="deck-new" title={t.newTitle}>
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">{t.newIntro}</p>
              <NewDeckForm locale={locale} create={createDeck} />
            </div>
          </Section>
        </>
      ) : (
        <Section id="decks-handle" title={t.handleTitle}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">{t.handleIntro}</p>
            <HandleForm locale={locale} choose={chooseHandle} />
          </div>
        </Section>
      )}
    </>
  )
}

function Status({ locale, summary }: { locale: Locale; summary: AuthorDeckSummary }) {
  const messages = deckMessages[locale]
  const { status, hiddenReason } = summary.deck
  return (
    <StatusBadge
      status={status}
      label={messages.status[status]}
      reason={hiddenReason}
      reasonLabel={messages.deck.hiddenReason}
    />
  )
}
