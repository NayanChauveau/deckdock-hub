'use client'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import type { Locale } from '@/core/i18n/locales'
import { Button } from '@/core/ui/button'
import { catalogueMessages } from '../catalogue-messages'

const SIDES = ['front', 'back'] as const
// Round pill buttons, 40 px (a comfortable touch target).
const arrow = 'size-10 rounded-full'

/**
 * The preview's carousel: one note at a time, its front and back side by side (stacked on a
 * phone), previous and next buttons that go round, and the position announced politely (« Note 2
 * sur 5 »). It only chooses which note's pair of frames is mounted: each frame is the hub's
 * isolated preview document (`/preview/…`, see preview-route.ts), in a sandbox without
 * same-origin, so the author's card never reaches the site or its cookies.
 */
export function PreviewCarousel({
  locale,
  notes,
}: {
  locale: Locale
  /** The preview routes of each note, front and back. */
  notes: readonly { front: string; back: string }[]
}) {
  const t = catalogueMessages[locale].deck
  const [index, setIndex] = useState(0)
  const count = notes.length
  const note = notes[index]
  if (!note) return null
  const go = (step: number) => {
    setIndex((current) => (current + step + count) % count)
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SIDES.map((side) => {
          const label = side === 'front' ? t.front : t.back
          return (
            <figure
              key={side}
              className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-muted p-2"
            >
              <figcaption className="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {label}
              </figcaption>
              {/* The card's document assumes a white page: a white frame in both themes. */}
              <iframe
                key={note[side]}
                src={note[side]}
                sandbox="allow-scripts"
                title={t.frameTitle(index + 1, label)}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="h-56 w-full rounded-lg bg-white"
              />
            </figure>
          )
        })}
      </div>
      {count > 1 ? (
        <div className="flex items-center justify-between gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={arrow}
            onClick={() => {
              go(-1)
            }}
          >
            <ChevronLeftIcon aria-hidden="true" className="size-5" />
            <span className="sr-only">{t.previousNote}</span>
          </Button>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {t.position(index + 1, count)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={arrow}
            onClick={() => {
              go(1)
            }}
          >
            <ChevronRightIcon aria-hidden="true" className="size-5" />
            <span className="sr-only">{t.nextNote}</span>
          </Button>
        </div>
      ) : null}
    </div>
  )
}
