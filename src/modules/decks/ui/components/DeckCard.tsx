import Link from 'next/link'
import { useId } from 'react'
import { DeckIcon } from './DeckIcon'

const chip =
  'max-w-full rounded-full bg-muted px-2 py-0.5 text-xs wrap-anywhere text-muted-foreground'

/**
 * A deck of the catalogue, clickable as a whole through one link: icon, name, a short description,
 * pills (its languages, then `pills`: notes, last update…) and a small line under them (`meta`:
 * the author). The link is named after the deck only; the rest of the card is its description for
 * assistive technologies.
 */
export function DeckCard({
  href,
  deckId,
  name,
  description,
  icon,
  languages,
  pills = [],
  meta,
}: {
  href: string
  deckId: string
  name: string
  description: string | null
  icon?: string | null | undefined
  languages: readonly string[]
  /** Pills after the languages (« 80 notes », « il y a 2 j »…). */
  pills?: readonly string[]
  /** A small line under the pills (the author). */
  meta?: string
}) {
  const id = useId()
  const descriptionId = `${id}-description`
  const detailsId = `${id}-details`
  const hasChips = languages.length > 0 || pills.length > 0
  const hasDetails = hasChips || Boolean(meta)
  const describedBy = [description ? descriptionId : null, hasDetails ? detailsId : null]
    .filter(Boolean)
    .join(' ')
  // A "stretched" link: only the name is the link's content (its accessible name is the deck's
  // name, as axe's label-content-name-mismatch wants), and its ::after covers the whole card.
  return (
    <div className="group relative flex min-w-0 flex-col gap-3 rounded-[var(--radius)] bg-card p-4 text-card-foreground shadow-[var(--shadow-card)] transition-shadow hover:shadow-md has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-ring">
      <DeckIcon icon={icon} name={name} deckId={deckId} />
      <span className="min-w-0">
        <Link
          href={href}
          aria-describedby={describedBy || undefined}
          className="block text-base font-semibold wrap-anywhere outline-none group-hover:text-brand after:absolute after:inset-0 after:rounded-[var(--radius)]"
        >
          {name}
        </Link>
        {description ? (
          <span
            id={descriptionId}
            className="mt-1 line-clamp-2 block text-sm wrap-anywhere text-muted-foreground"
          >
            {description}
          </span>
        ) : null}
      </span>
      {hasDetails ? (
        <span id={detailsId} className="mt-auto flex min-w-0 flex-col gap-2">
          {hasChips ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {languages.map((language) => (
                <span key={`language-${language}`} className={chip}>
                  {language}
                </span>
              ))}
              {pills.map((pill) => (
                <span key={`pill-${pill}`} className={chip}>
                  {pill}
                </span>
              ))}
            </span>
          ) : null}
          {meta ? (
            <span className="block min-w-0 text-xs wrap-anywhere text-muted-foreground">
              {meta}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
