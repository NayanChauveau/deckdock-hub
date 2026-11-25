import type { SelectFieldServerProps } from 'payload'

export function OrderPaymentStatus({ field, value }: SelectFieldServerProps) {
  const option = field.options.find((option) =>
    typeof option === 'string' ? option === value : option.value === value,
  )
  const label = typeof option === 'string' ? option : option?.label
  const paid = value === 'paid'

  return (
    <div className="field-type">
      <p
        style={{
          margin: 0,
          paddingBottom: 'calc(var(--base) * 0.25)',
          lineHeight: 'var(--base)',
          color: 'var(--theme-elevation-800)',
        }}
      >
        Paiement
      </p>
      {/* The height of a select control, so the badge stays centred on its neighbour whatever
          description sits below it in the row. */}
      <div style={{ display: 'flex', alignItems: 'center', height: 'calc(var(--base) * 2)' }}>
        <span
          style={{
            borderRadius: 4,
            padding: '6px 12px',
            fontWeight: 600,
            background: paid ? '#dcfce7' : 'var(--theme-elevation-100)',
            color: paid ? '#14532d' : 'var(--theme-text)',
          }}
        >
          {typeof label === 'string' ? label : '—'}
        </span>
      </div>
    </div>
  )
}
