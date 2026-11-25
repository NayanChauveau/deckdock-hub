/**
 * An amount stored in cents, written in euros for the administration ("214,00 €"). Amounts stay
 * in cents everywhere else: only what a person reads is converted.
 */
export function adminAmount(cents: unknown, currency: unknown = 'EUR'): string {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '—'
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: typeof currency === 'string' && currency ? currency : 'EUR',
  }).format(cents / 100)
}
