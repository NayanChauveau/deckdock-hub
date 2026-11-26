const STATUS = {
  approved: { label: 'Approved', tone: 'bg-secondary text-brand' },
  pending: { label: 'Pending', tone: 'bg-muted text-muted-foreground' },
  hidden: { label: 'Hidden', tone: 'bg-muted text-destructive' },
} as const

/** A status pill. `label` is the translated text; the English one is only a default. */
export function StatusBadge({
  status,
  label,
}: {
  status: 'approved' | 'pending' | 'hidden'
  label?: string
}) {
  const { label: fallback, tone } = STATUS[status]
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {label ?? fallback}
    </span>
  )
}
