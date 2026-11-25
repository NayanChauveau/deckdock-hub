import type { JSONFieldServerProps } from 'payload'
import { adminAmount } from './money'

interface Line {
  label: string
  unitCents: number
  quantity: number
}
const isLine = (value: unknown): value is Line =>
  Boolean(value) &&
  typeof value === 'object' &&
  typeof (value as Line).label === 'string' &&
  typeof (value as Line).unitCents === 'number' &&
  typeof (value as Line).quantity === 'number'

const cell = { padding: '8px 10px', borderBottom: '1px solid var(--theme-elevation-150)' }
const number = { ...cell, textAlign: 'right' as const, whiteSpace: 'nowrap' as const }

/** The order lines as a table in euros; the stored lines keep their amounts in cents. */
export function OrderLines({ value, siblingData }: JSONFieldServerProps) {
  const lines = Array.isArray(value) ? value.filter(isLine) : []
  const currency: unknown = siblingData['currency']
  return (
    <div className="field-type">
      <p style={{ margin: 0, paddingBottom: 'calc(var(--base) * 0.25)' }}>Lignes</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ color: 'var(--theme-elevation-600)' }}>
            <th style={{ ...cell, textAlign: 'left', fontWeight: 500 }}>Article</th>
            <th style={{ ...number, fontWeight: 500 }}>Quantité</th>
            <th style={{ ...number, fontWeight: 500 }}>Prix unitaire</th>
            <th style={{ ...number, fontWeight: 500 }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) => (
            <tr key={index}>
              <td style={cell}>{line.label}</td>
              <td style={number}>{line.quantity}</td>
              <td style={number}>{adminAmount(line.unitCents, currency)}</td>
              <td style={number}>{adminAmount(line.unitCents * line.quantity, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
