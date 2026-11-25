import { cookies } from 'next/headers'
import { maintenanceResponse, maintenanceState } from '@/core/http/maintenance'
import {
  boundedBody,
  privateHeaders,
  requestIdentity,
  sameOrigin,
} from '@/core/http/request-guards'
import { errorResponse } from '../../orders/adapters/http/errors'
import { paymentRequestSchema } from '../../orders/contracts'
import { OrderError } from '../../orders/domain/errors'
import { orderCookieName } from '../../orders/reference'
import { getOrders } from '../../orders/server'

/** Reopens (or replaces) the payment of an unpaid order, for the holder of its cookie only. */
export async function POST(request: Request) {
  // Visitors cannot order or look up orders while the site is in maintenance.
  if ((await maintenanceState(request.headers)).visitorBlocked) return maintenanceResponse()
  try {
    sameOrigin(request)
    const input: unknown = JSON.parse((await boundedBody(request, 1024)).toString())
    const result = paymentRequestSchema.safeParse(input)
    if (!result.success) throw new OrderError('not_found')
    const { reference } = result.data
    const orders = await getOrders()
    await orders.traffic.execute(requestIdentity(request), 'checkout', 10)
    const retry = await orders.payments.retry(
      reference,
      (await cookies()).get(orderCookieName(reference))?.value,
    )
    return Response.json(retry, { headers: privateHeaders })
  } catch (error) {
    return errorResponse(error)
  }
}
