import Link from 'next/link'
import { DeckIcon } from './DeckIcon'

/** A deck of the catalogue: icon, name, a short description and its languages, as one link. */
export function DeckCard({
  href,
  deckId,
  name,
  description,
  icon,
  languages,
  meta,
}: {
  href: string
  deckId: string
  name: string
  description: string | null
  icon?: string | null | undefined
  languages: readonly string[]
  /** A small line under the chips (author, notes, editions…). */
  meta?: string
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 flex-col gap-3 rounded-[var(--radius)] bg-card p-4 text-card-foreground shadow-[var(--shadow-card)] transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-ring"
    >
      <DeckIcon icon={icon} name={name} deckId={deckId} />
      <span className="min-w-0">
        <span className="block break-words text-base font-semibold group-hover:text-brand">
          {name}
        </span>
        {description ? (
          <span className="mt-1 line-clamp-2 block break-words text-sm text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
      {languages.length > 0 || meta ? (
        <span className="mt-auto flex flex-wrap items-center gap-1.5">
          {languages.map((language) => (
            <span
              key={language}
              className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
            >
              {language}
            </span>
          ))}
          {meta ? (
            <span className="min-w-0 break-words text-xs text-muted-foreground">{meta}</span>
          ) : null}
        </span>
      ) : null}
    </Link>
  )
}
