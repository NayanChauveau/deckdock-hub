import { COUNTRY_CODES } from '@/core/domain/countries'

export interface AddressSuggestion {
  id: string
  label: string
}
export interface AddressQuery {
  query: string
  country: string
  locale: 'fr' | 'en'
  session: string
}
export interface AddressDetails {
  address: string
  postalCode: string
  city: string
  country: string
}
export interface AddressDetailsQuery {
  id: string
  country: string
  locale: 'fr' | 'en'
  session: string
}
export interface AddressProvider {
  search(input: AddressQuery): Promise<AddressSuggestion[]>
  details(input: AddressDetailsQuery): Promise<AddressDetails | null>
}

export class InvalidAddressQuery extends Error {}
export class AddressSearchUnavailable extends Error {}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function validCommon(input: { country: string; locale: string; session: string }) {
  return (
    COUNTRY_CODES.includes(input.country) &&
    ['fr', 'en'].includes(input.locale) &&
    uuid.test(input.session)
  )
}

export class SuggestAddresses {
  constructor(private provider: AddressProvider) {}
  async execute(input: AddressQuery): Promise<AddressSuggestion[]> {
    const query = input.query.trim().replace(/\s+/g, ' ')
    if (query.length > 200 || /[\u0000-\u001f]/.test(query) || !validCommon(input))
      throw new InvalidAddressQuery()
    if (query.length < 3) return []
    const suggestions = await this.provider.search({ ...input, query })
    return suggestions.filter((item) => item.id && item.label.trim()).slice(0, 5)
  }
  async details(input: AddressDetailsQuery): Promise<AddressDetails | null> {
    if (!input.id || input.id.length > 300 || !validCommon(input)) throw new InvalidAddressQuery()
    const details = await this.provider.details(input)
    // Never an address from another country, whatever the provider answered. Empty parts mean
    // "unknown": the form keeps what the customer typed there.
    if (details?.country !== input.country) return null
    if (!details.address.trim() && !details.postalCode.trim() && !details.city.trim()) return null
    return details
  }
}
