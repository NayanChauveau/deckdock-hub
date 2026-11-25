import '@/core/zod'
import { z } from 'zod'

export const errorSchema = z.object({ error: z.string() })
export const orderLinkSchema = z.object({ url: z.string().min(1) })
export const accessRequestSchema = z.object({
  reference: z.string(),
  token: z.string(),
  locale: z.enum(['fr', 'en']).optional(),
})
export const paymentRequestSchema = z.object({ reference: z.string() })
export const paymentRetrySchema = z.object({ url: z.url({ protocol: /^https$/ }).nullable() })
