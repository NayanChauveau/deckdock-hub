import '@/core/zod'
import { z } from 'zod'
import { COUNTRY_CODES } from '@/core/domain/countries'
const country = z.string().refine((code) => COUNTRY_CODES.includes(code))
const session = z.uuid()
export const addressQuerySchema = z.object({
  query: z.string().max(200),
  country,
  locale: z.enum(['fr', 'en']),
  session,
})
export const addressDetailsQuerySchema = z.object({
  id: z.string().min(1).max(300),
  country,
  locale: z.enum(['fr', 'en']),
  session,
})
export const addressSuggestionSchema = z.object({
  id: z.string(),
  label: z.string().max(500),
})
export const addressSuggestionsSchema = z.object({
  suggestions: z.array(addressSuggestionSchema).max(5),
})
export const addressDetailsSchema = z.object({
  address: z.string().max(200),
  postalCode: z.string().max(10),
  city: z.string().max(100),
  country,
})
export const addressDetailsResponseSchema = z.object({
  address: addressDetailsSchema.nullable(),
})
export type AddressSuggestion = z.infer<typeof addressSuggestionSchema>
export type AddressDetails = z.infer<typeof addressDetailsSchema>
