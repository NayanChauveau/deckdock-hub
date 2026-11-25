import { cookies } from 'next/headers'
import { maintenanceResponse, maintenanceState } from '@/core/http/maintenance'
import { boundedBody, privateHeaders, sameOrigin } from '@/core/http/request-guards'
import { errorResponse } from '../../orders/adapters/http/errors'
import { paymentRequestSchema } from '../../orders/contracts'
import { OrderError } from '../../orders/domain/errors'
import { orderCookieName } from '../../orders/reference'
import { getOrders } from '../../orders/server'

/** Local simulation only: pays the order as a provider notification would. */
export async function POST(request: Request) {
  // Visitors cannot order or look up orders while the site is in maintenance.
  if ((await maintenanceState(request.headers)).visitorBlocked) return maintenanceResponse()
  try {
    sameOrigin(request)
    const input: unknown = JSON.parse((await boundedBody(request, 1024)).toString())
    const result = paymentRequestSchema.safeParse(input)
    if (!result.success) throw new OrderError('not_found')
    const { reference } = result.data
    await (
      await getOrders()
    ).payments.simulate(reference, (await cookies()).get(orderCookieName(reference))?.value)
    return Response.json({ ok: true }, { headers: privateHeaders })
  } catch (error) {
    return errorResponse(error)
  }
}
