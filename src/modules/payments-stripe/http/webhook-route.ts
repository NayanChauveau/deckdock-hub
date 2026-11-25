import { boundedBody } from '@/core/http/request-guards'
import { errorResponse } from '../../orders/adapters/http/errors'
import { getOrders } from '../../orders/server'

/** Stripe notifications: verified by signature, applied once per event id. */
export async function POST(request: Request) {
  try {
    const body = await boundedBody(request, 1024 * 1024)
    await (
      await getOrders()
    ).payments.handleWebhook(body, request.headers.get('stripe-signature') || '')
    return Response.json({ received: true })
  } catch (error) {
    return errorResponse(error)
  }
}
