import '@/core/zod'
import { z } from 'zod'
import { POSTAL_CODE } from '@/core/domain/countries'
import type {
  AddressDetails,
  AddressProvider,
  AddressQuery,
  AddressSuggestion,
} from '../application/suggest-addresses'
import { AddressSearchUnavailable } from '../application/suggest-addresses'

const base = 'https://places.googleapis.com/v1'
/** Addresses only (Places Table B types, at most five): no shops, towns or bare streets. */
export const ADDRESS_TYPES = ['street_address', 'premise', 'subpremise']
const autocomplete = z.object({
  suggestions: z
    .array(
      z.object({
        placePrediction: z
          .object({ placeId: z.string(), text: z.object({ text: z.string() }) })
          .optional(),
      }),
    )
    .max(20)
    .optional(),
})
const place = z.object({
  addressComponents: z
    .array(z.object({ longText: z.string(), shortText: z.string(), types: z.array(z.string()) }))
    .max(40),
})

/** Google Places (New). The key stays on the server, in a header, never in a URL. */
export class GooglePlacesAddressProvider implements AddressProvider {
  constructor(
    private key: string | undefined,
    private http: typeof fetch = fetch,
  ) {}

  private async call(url: string, init: RequestInit, fieldMask?: string): Promise<unknown> {
    if (!this.key) throw new AddressSearchUnavailable()
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Goog-Api-Key': this.key,
      }
      if (fieldMask) headers['X-Goog-FieldMask'] = fieldMask
      if (init.body) headers['Content-Type'] = 'application/json'
      const response = await this.http(url, {
        ...init,
        headers,
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      })
      if (!response.ok) throw new AddressSearchUnavailable()
      return await response.json()
    } catch {
      throw new AddressSearchUnavailable()
    }
  }

  async search(input: AddressQuery): Promise<AddressSuggestion[]> {
    const data = await this.call(
      `${base}/places:autocomplete`,
      {
        method: 'POST',
        body: JSON.stringify({
          input: input.query,
          includedRegionCodes: [input.country],
          includedPrimaryTypes: ADDRESS_TYPES,
          languageCode: input.locale,
          sessionToken: input.session,
        }),
      },
      'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text',
    )
    const parsed = autocomplete.safeParse(data)
    if (!parsed.success) throw new AddressSearchUnavailable()
    const result: AddressSuggestion[] = []
    for (const item of parsed.data.suggestions ?? [])
      if (item.placePrediction)
        result.push({ id: item.placePrediction.placeId, label: item.placePrediction.text.text })
    return result
  }

  async details(input: {
    id: string
    country: string
    locale: 'fr' | 'en'
    session: string
  }): Promise<AddressDetails | null> {
    const url = new URL(`${base}/places/${encodeURIComponent(input.id)}`)
    url.searchParams.set('sessionToken', input.session)
    url.searchParams.set('languageCode', input.locale)
    const data = await this.call(url.toString(), { method: 'GET' }, 'addressComponents')
    const parsed = place.safeParse(data)
    if (!parsed.success) throw new AddressSearchUnavailable()
    const components = parsed.data.addressComponents
    const find = (type: string) => components.find((c) => c.types.includes(type))
    if (find('country')?.shortText.toUpperCase() !== input.country) return null
    // Without a house number the place is only a street: the customer's typed line is better
    // (an empty address tells the field to keep it).
    const number = find('street_number')?.longText
    const street = number ? [number, find('route')?.longText].filter(Boolean).join(' ') : ''
    const city = (find('locality') ?? find('postal_town'))?.longText ?? ''
    const postalCode = find('postal_code')?.longText.trim() ?? ''
    return {
      address: street,
      postalCode: POSTAL_CODE.test(postalCode) ? postalCode : '',
      city,
      country: input.country,
    }
  }
}
