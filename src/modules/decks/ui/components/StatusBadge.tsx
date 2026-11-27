const STATUS = {
  approved: { label: 'Approved', tone: 'bg-secondary text-brand' },
  pending: { label: 'Pending', tone: 'bg-muted text-muted-foreground' },
  hidden: { label: 'Hidden', tone: 'bg-muted text-destructive' },
} as const

/**
 * A status pill. `label` is the translated text; the English one is only a default. A hidden
 * deck's `reason` follows the pill (after `reasonLabel`), so the author knows why.
 */
export function StatusBadge({
  status,
  label,
  reason,
  reasonLabel = 'Reason:',
  testId,
}: {
  status: 'approved' | 'pending' | 'hidden'
  label?: string
  reason?: string | null | undefined
  reasonLabel?: string
  /** `data-testid` of the pill itself (its text is the status only). */
  testId?: string
}) {
  const { label: fallback, tone } = STATUS[status]
  const pill = (
    <span
      data-testid={testId}
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {label ?? fallback}
    </span>
  )
  const why = status === 'hidden' ? reason?.trim() : undefined
  if (!why) return pill
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {pill}
      <span className="min-w-0 text-xs wrap-anywhere text-muted-foreground">
        {reasonLabel} {why}
      </span>
    </span>
  )
}
