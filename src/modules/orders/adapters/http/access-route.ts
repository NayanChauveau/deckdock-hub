import { NextResponse } from 'next/server'
import { maintenanceResponse, maintenanceState } from '@/core/http/maintenance'
import { boundedBody, privateHeaders, sameOrigin } from '@/core/http/request-guards'
import { accessRequestSchema } from '../../contracts'
import { OrderError } from '../../domain/errors'
import { trackingPath } from '../../paths'
import { orderCookieName, orderCookieOptions } from '../../reference'
import { getOrders } from '../../server'
import { errorResponse } from './errors'

/** Exchanges the private link of an email (reference and token) for the order's cookie. */
export async function POST(request: Request) {
  // Visitors cannot order or look up orders while the site is in maintenance.
  if ((await maintenanceState(request.headers)).visitorBlocked) return maintenanceResponse()
  try {
    sameOrigin(request)
    const input: unknown = JSON.parse((await boundedBody(request, 1024)).toString())
    const result = accessRequestSchema.safeParse(input)
    if (!result.success) throw new OrderError('not_found')
    const { reference, token, locale } = result.data
    const orders = await getOrders()
    orders.access.authorize(reference, token)
    const response = NextResponse.json(
      { url: trackingPath(locale === 'en' ? 'en' : 'fr', reference) },
      { headers: privateHeaders },
    )
    response.cookies.set(orderCookieName(reference), token, orderCookieOptions)
    return response
  } catch (error) {
    return errorResponse(error)
  }
}
