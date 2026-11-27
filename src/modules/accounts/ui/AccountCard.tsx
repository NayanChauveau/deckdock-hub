import type { ReactNode } from 'react'

/** A card of the account pages (as the decks module's sections): white with a soft shadow, or a
 *  thin border in the dark theme (the tokens decide). */
export const card =
  'min-w-0 rounded-[var(--radius)] bg-card p-5 text-card-foreground shadow-[var(--shadow-card)]'

/**
 * The centered card of the account's short pages (sign-in, its « link sent » and « link expired »
 * states, the deleted account): a mark, the title, a lead, then the content.
 */
export function AccountCard({
  title,
  lead,
  children,
}: {
  title: string
  lead?: string
  children: ReactNode
}) {
  return (
    <div className="flex justify-center bg-[radial-gradient(420px_220px_at_50%_0%,var(--secondary),transparent)] px-4 py-12 sm:py-20">
      <div className="flex w-full max-w-md min-w-0 flex-col gap-5 rounded-[var(--radius)] bg-card p-6 text-card-foreground shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden="true"
            className="inline-flex size-10 items-center justify-center rounded-[10px] bg-primary text-lg text-primary-foreground"
          >
            ●
          </span>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {lead && <p className="text-sm text-muted-foreground">{lead}</p>}
        </div>
        {children}
      </div>
    </div>
  )
}
