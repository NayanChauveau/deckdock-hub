import type { ReactNode } from 'react'

/** A titled block of a page: a card with a heading and its content. */
export function Section({
  title,
  id,
  className = '',
  children,
}: {
  title: string
  id?: string
  /** Extra classes for the card (a highlighted border…). */
  className?: string
  children: ReactNode
}) {
  const headingId = id ? `${id}-title` : undefined
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`min-w-0 rounded-[var(--radius)] bg-card p-5 text-card-foreground shadow-[var(--shadow-card)] ${className}`}
    >
      <h2 id={headingId} className="mb-3 text-base font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}
