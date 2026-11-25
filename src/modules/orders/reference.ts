import { ordersSettings } from './settings'
import { orderReferencePattern } from './domain/value-objects'

const reference = orderReferencePattern(ordersSettings.referencePrefix)
/** True for a reference of this site (public routes reject anything else before any lookup). */
export function isOrderReference(value: string): boolean {
  return reference.test(value)
}
/** Name of the private cookie that opens one order's tracking page. */
export function orderCookieName(orderReference: string): string {
  return `${ordersSettings.accessCookiePrefix}${orderReference}`
}
/** The private cookie that holds an order's access token, set by checkout and the access link. */
export const orderCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 180 * 86400,
} as const
