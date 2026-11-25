import { OrderError } from '../domain/errors'
import type { OrderDetails, OrderLine, OrderSnapshot } from '../domain/model'
import { Order, PAYMENT_WINDOW_MS } from '../domain/order'
import {
  customerCommentValue,
  customerValue,
  EuroAmount,
  languageValue,
} from '../domain/value-objects'
import type { OrderExtension } from './extension'
import type { Clock, Identifiers, PaymentGateway, Transaction, UnitOfWork } from './ports'

/** What the selling module decided: priced lines, shipping and its own details. */
export interface OrderDraft<D extends OrderDetails = OrderDetails> {
  attemptId: string
  locale: string
  customer: Record<string, unknown>
  termsAccepted: boolean
  comment?: string
  lines: OrderLine[]
  shippingCents: number
  details: D
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export class PlaceOrder<D extends OrderDetails, X> {
  constructor(
    private uow: UnitOfWork<D, X>,
    private clock: Clock,
    private ids: Identifiers,
    private payments: PaymentGateway,
    private extension: OrderExtension<D, X>,
  ) {}

  /** Inside the caller's transaction, so the selling module can price and reserve atomically. */
  async within(tx: Transaction<D, X>, draft: OrderDraft<D>): Promise<Order<D>> {
    if (!draft.termsAccepted) throw new OrderError('terms')
    if (!uuid.test(draft.attemptId)) throw new OrderError('attempt')
    const customer = customerValue(draft.customer)
    const locale = languageValue(draft.locale)
    const comment = customerCommentValue(draft.comment)
    const now = this.clock.now().toISOString()
    const existing = await tx.orders.findByAttempt(draft.attemptId)
    if (existing) {
      existing.sameAttempt(customer, comment, now)
      return existing
    }
    const settings = await tx.settings()
    if (!settings.enabled) throw new OrderError('closed')
    if (!settings.countries.includes(customer.country)) throw new OrderError('country')
    const itemsCents = draft.lines.reduce(
      (sum, line) => sum.plus(EuroAmount.of(line.unitCents).times(line.quantity)),
      EuroAmount.of(0),
    )
    const state: OrderSnapshot<D> = {
      id: 0,
      reference: this.ids.orderReference(),
      attemptId: draft.attemptId,
      locale,
      kind: this.extension.kind,
      customer,
      lines: draft.lines,
      itemsCents: itemsCents.cents,
      shippingCents: draft.shippingCents,
      totalCents: itemsCents.plus(EuroAmount.of(draft.shippingCents)).cents,
      currency: 'EUR',
      paymentStatus: 'pending',
      fulfillmentStatus: 'awaiting_payment',
      paymentSessionId: null,
      paymentId: null,
      paymentExpiresAt: new Date(this.clock.now().getTime() + PAYMENT_WINDOW_MS).toISOString(),
      paidAt: null,
      shippedAt: null,
      trackingNumber: null,
      customerComment: comment,
      internalNote: null,
      termsVersion: await tx.termsVersion(),
      termsAcceptedAt: now,
      history: [],
      details: draft.details,
      createdAt: now,
      updatedAt: now,
    }
    return tx.orders.create(Order.place(state))
  }

  /** After the order is committed: opens (or reopens) its payment session. */
  async openPayment(placed: Order<D>) {
    let order = placed
    const existingSessionId = order.snapshot.paymentSessionId
    const session = existingSessionId
      ? await this.payments.readSession(existingSessionId)
      : await this.payments.createSession(order.snapshot)
    if (!existingSessionId && this.payments.mode() !== 'simulation') {
      order = await this.uow.run(async (tx) => {
        const fresh = await tx.orders.findById(placed.snapshot.id)
        if (!fresh) throw new OrderError('not_found')
        fresh.attachPaymentSession(session.id, this.clock.now().toISOString())
        await tx.orders.save(fresh)
        return fresh
      })
    }
    if (!session.url || !session.open) throw new OrderError('expired')
    return {
      order: order.snapshot,
      url: session.url,
      simulated: this.payments.mode() === 'simulation',
    }
  }
}
