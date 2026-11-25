import type {
  AddressDetails,
  AddressDetailsQuery,
  AddressProvider,
  AddressQuery,
  AddressSuggestion,
} from '../application/suggest-addresses'
import { AddressSearchUnavailable } from '../application/suggest-addresses'

/**
 * Bounded process-local cache and one process-wide budget of provider calls: searches and
 * details of every country draw from the same token bucket, so neither a forged origin nor a
 * rotation of countries can make the paid provider cost more than `perMinute` calls a minute.
 * Beyond it the search answers "unavailable" and the customer types the address by hand.
 * No addresses in logs or on disk.
 */
export class PacedAddressProvider implements AddressProvider {
  private cache = new Map<string, { at: number; suggestions: AddressSuggestion[] }>()
  private tokens: number
  private refilled: number
  constructor(
    private provider: AddressProvider,
    private now: () => number = Date.now,
    private budget: { perMinute: number; burst: number } = { perMinute: 60, burst: 10 },
  ) {
    this.tokens = budget.burst
    this.refilled = now()
  }
  /** Takes one call from the shared budget, or refuses. */
  private spend() {
    const now = this.now()
    const elapsed = Math.max(0, now - this.refilled)
    this.refilled = now
    this.tokens = Math.min(
      this.budget.burst,
      this.tokens + (elapsed * this.budget.perMinute) / 60_000,
    )
    if (this.tokens < 1) throw new AddressSearchUnavailable()
    this.tokens -= 1
  }
  async search(input: AddressQuery): Promise<AddressSuggestion[]> {
    const now = this.now()
    const key = JSON.stringify([input.query, input.country, input.locale])
    const cached = this.cache.get(key)
    if (cached && now - cached.at < 60_000) return structuredClone(cached.suggestions)
    this.spend()
    const suggestions = await this.provider.search(input)
    if (this.cache.size >= 128) this.cache.clear()
    this.cache.set(key, { at: now, suggestions: structuredClone(suggestions) })
    return suggestions
  }
  async details(input: AddressDetailsQuery): Promise<AddressDetails | null> {
    this.spend()
    return await this.provider.details(input)
  }
}
