import type { NumberFieldServerProps } from 'payload'
import { adminAmount } from './money'

const box = {
  padding: '8px 15px',
  minHeight: 40,
  border: '1px solid var(--theme-elevation-150)',
  borderRadius: 4,
  background: 'var(--theme-elevation-50)',
  color: 'var(--theme-elevation-800)',
  lineHeight: '22px',
}

/** A read-only order amount, stored in cents, shown in euros. */
export function OrderAmount({ field, value, siblingData }: NumberFieldServerProps) {
  const label = typeof field.label === 'string' ? field.label : field.name
  return (
    <div className="field-type" style={{ flex: 1 }}>
      <p style={{ margin: 0, paddingBottom: 'calc(var(--base) * 0.25)' }}>{label}</p>
      <div style={box}>{adminAmount(value, siblingData['currency'])}</div>
    </div>
  )
}
