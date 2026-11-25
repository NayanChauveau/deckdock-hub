import { COUNTRY_CODES, POSTAL_CODE } from '@/core/domain/countries'
import { OrderError } from './errors'

/** An uppercase ISO 3166-1 alpha-2 code, validated by countryValue. */
export type Country = string
export type Language = 'fr' | 'en'
export type Customer = Readonly<{
  name: string
  email: string
  address: string
  address2: string
  postalCode: string
  city: string
  country: Country
}>

export function countryValue(value: unknown): Country {
  if (typeof value !== 'string' || !COUNTRY_CODES.includes(value)) throw new OrderError('country')
  return value
}
export function languageValue(value: unknown): Language {
  if (value !== 'fr' && value !== 'en') throw new OrderError('locale')
  return value
}
export function textValue(value: unknown, max: number, optional = false): string {
  if (
    typeof value !== 'string' ||
    (!value.trim() && !optional) ||
    value.length > max ||
    /[\u0000-\u001f]/.test(value)
  )
    throw new OrderError('customer')
  return value.trim()
}
export function customerValue(value: Record<string, unknown>): Customer {
  const country = countryValue(value['country'])
  const email = textValue(value['email'], 254).toLowerCase()
  const rawPostalCode = value['postalCode']
  const postalCode = typeof rawPostalCode === 'string' ? rawPostalCode.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new OrderError('email')
  // One generic rule for every country; stricter checks belong to the carrier.
  if (!POSTAL_CODE.test(postalCode)) throw new OrderError('postal_code')
  return Object.freeze({
    name: textValue(value['name'], 100),
    email,
    address: textValue(value['address'], 200),
    address2: textValue(value['address2'] ?? '', 200, true),
    postalCode,
    city: textValue(value['city'], 100),
    country,
  })
}

export class EuroAmount {
  private constructor(public readonly cents: number) {
    Object.freeze(this)
  }
  static of(cents: number): EuroAmount {
    if (!Number.isSafeInteger(cents) || cents < 0 || cents > 99_999_999)
      throw new OrderError('prices_unavailable')
    return new EuroAmount(cents)
  }
  plus(other: EuroAmount): EuroAmount {
    return EuroAmount.of(this.cents + other.cents)
  }
  times(quantity: number): EuroAmount {
    return EuroAmount.of(this.cents * quantity)
  }
}

export function euroCurrency(value: unknown): 'EUR' {
  if (value !== 'EUR') throw new OrderError('prices_unavailable')
  return value
}

export class OrderReference {
  private constructor(public readonly value: string) {
    Object.freeze(this)
  }
  /** Generic shape; the site's exact prefix is checked at the edge (orderReferencePattern). */
  static of(value: string): OrderReference {
    if (!/^[A-Z]{2,6}-[A-F0-9]{16}$/.test(value)) throw new OrderError('reference')
    return new OrderReference(value)
  }
}
/** The exact shape of this site's references (prefix from the site configuration). */
export function orderReferencePattern(prefix: string): RegExp {
  return new RegExp(`^${prefix}-[A-F0-9]{16}$`)
}

export const MAX_CUSTOMER_COMMENT_LENGTH = 2000
export function customerCommentValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (
    typeof value !== 'string' ||
    value.length > MAX_CUSTOMER_COMMENT_LENGTH ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    throw new OrderError('comment')
  return value.replace(/\r\n?/g, '\n').trim()
}
