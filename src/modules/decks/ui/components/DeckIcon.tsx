const COLORS = 8
export const INITIAL_COLORS = COLORS

/** A stable colour of the palette (`--initial-1..8`) for a deck id: the same id, the same colour. */
export function initialColor(deckId: string): string {
  let hash = 0
  for (const char of deckId) hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  return `var(--initial-${(hash % COLORS) + 1})`
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/** The first grapheme of the name, uppercased (`?` for an empty name). */
function initialOf(name: string): string {
  const first = segmenter.segment(name.trim())[Symbol.iterator]().next()
  return first.done ? '?' : first.value.segment.toLocaleUpperCase()
}

const SIZES = {
  sm: 'size-8 rounded-lg text-base',
  md: 'size-10 rounded-[10px] text-xl',
  lg: 'size-14 rounded-xl text-3xl',
} as const

/**
 * The deck's tile: its emoji when it has one, else the initial of its name, white on a colour that
 * comes from its id. Decorative: the deck's name is always written next to it.
 */
export function DeckIcon({
  icon,
  name,
  deckId,
  size = 'md',
}: {
  icon?: string | null | undefined
  name: string
  deckId: string
  size?: 'sm' | 'md' | 'lg'
}) {
  const emoji = icon?.trim()
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center font-semibold leading-none ${SIZES[size]} ${emoji ? 'bg-secondary' : 'text-[color:var(--initial-foreground)]'}`}
      style={emoji ? undefined : { backgroundColor: initialColor(deckId) }}
    >
      {emoji || initialOf(name)}
    </span>
  )
}
