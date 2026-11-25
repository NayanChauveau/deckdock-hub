import type { TextFieldServerProps } from 'payload'
import { countryName } from '@/core/domain/countries'

/** Read-only delivery country shown by its French name; the stored value stays the ISO code. */
export function OrderCountry({ field, value }: TextFieldServerProps) {
  const code = typeof value === 'string' ? value : ''
  const label = typeof field.label === 'string' ? field.label : 'Pays'
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
        {label}
      </p>
      <div style={{ lineHeight: 'var(--base)' }}>{code ? countryName(code, 'fr') : '—'}</div>
    </div>
  )
}
