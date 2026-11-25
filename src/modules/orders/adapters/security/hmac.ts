import { createHmac, timingSafeEqual } from 'node:crypto'
import type { OrderLinks, Signer } from '../../application/ports'
import { legalPath } from '@/core/i18n/legal'
import type { OrderSnapshot } from '../../domain/model'
import { accessPath } from '../../paths'
export class HmacSigner implements Signer {
  constructor(private secret: string) {
    if (secret.length < 32) throw new Error('Secret serveur trop court.')
  }
  sign(value: string) {
    return createHmac('sha256', this.secret).update(value).digest('base64url')
  }
  orderToken(reference: string) {
    return this.sign(`order-access:${reference}`)
  }
  verifyOrderToken(reference: string, token: string | null | undefined) {
    if (token?.length !== 43) return false
    const expected = Buffer.from(this.orderToken(reference)),
      supplied = Buffer.from(token)
    return expected.length === supplied.length && timingSafeEqual(expected, supplied)
  }
}
export class SignedOrderLinks implements OrderLinks {
  constructor(
    private origin: string,
    private signer: Signer,
  ) {}
  admin(order: OrderSnapshot) {
    return new URL(`/admin/collections/orders/${order.id}`, this.origin).toString()
  }
  home(order: OrderSnapshot) {
    return new URL(`/${order.locale}`, this.origin).toString()
  }
  terms(order: OrderSnapshot) {
    return new URL(legalPath(order.locale, 'terms'), this.origin).toString()
  }
  tracking(order: OrderSnapshot) {
    const url = new URL(accessPath(order.locale), this.origin)
    url.hash = new URLSearchParams({
      reference: order.reference,
      token: this.signer.orderToken(order.reference),
    }).toString()
    return url.toString()
  }
}
