import { OrderError } from './errors'
import type {
  FulfillmentStatus,
  OrderDetails,
  OrderEvent,
  OrderSnapshot,
  PaymentUpdate,
} from './model'
import {
  customerCommentValue,
  EuroAmount,
  euroCurrency,
  OrderReference,
  type Customer,
} from './value-objects'

/** How long a checkout session stays payable. */
export const PAYMENT_WINDOW_MS = 31 * 60_000
/** A failed or expired payment can be retried within this time after the order was placed. */
export const PAYMENT_RETRY_WINDOW_MS = 86_400_000

const transitions: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  awaiting_payment: ['queued', 'cancelled'],
  queued: ['in_progress', 'cancelled'],
  in_progress: ['ready', 'cancelled'],
  ready: ['shipped', 'cancelled'],
  shipped: [],
  cancelled: [],
}
const paymentStatuses = ['pending', 'paid', 'failed', 'expired', 'partially_refunded', 'refunded']

/**
 * Aggregate root of an order, whatever is sold. Every change enforces the invariants and produces
 * explicit events. What is sold lives in `details`, owned by an extension, and changes only
 * through amendDetails.
 */
export class Order<D extends OrderDetails = OrderDetails> {
  private events: OrderEvent[] = []

  private constructor(private state: OrderSnapshot<D>) {
    customerCommentValue(state.customerComment)
    OrderReference.of(state.reference)
    euroCurrency(state.currency)
    let items = EuroAmount.of(0)
    for (const line of state.lines) {
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1)
        throw new OrderError('prices_unavailable')
      items = items.plus(EuroAmount.of(line.unitCents).times(line.quantity))
    }
    if (items.cents !== state.itemsCents) throw new OrderError('prices_unavailable')
    if (items.plus(EuroAmount.of(state.shippingCents)).cents !== state.totalCents)
      throw new OrderError('prices_unavailable')
    if (!(state.fulfillmentStatus in transitions)) throw new OrderError('transition')
    if (!paymentStatuses.includes(state.paymentStatus)) throw new OrderError('payment_state')
  }

  static restore<D extends OrderDetails>(state: OrderSnapshot<D>): Order<D> {
    return new Order(structuredClone(state))
  }

  static place<D extends OrderDetails>(state: OrderSnapshot<D>): Order<D> {
    if (
      state.id !== 0 ||
      state.paymentStatus !== 'pending' ||
      state.fulfillmentStatus !== 'awaiting_payment'
    )
      throw new OrderError('order_state')
    if (!state.termsVersion || !state.termsAcceptedAt) throw new OrderError('terms')
    return new Order({
      ...structuredClone(state),
      history: [{ at: state.createdAt, action: 'created' }],
    })
  }

  get snapshot(): OrderSnapshot<D> {
    return structuredClone(this.state)
  }

  releaseEvents(): OrderEvent[] {
    const events = this.events
    this.events = []
    return events
  }

  private record(now: string, actor: string | number = 'system') {
    this.state.updatedAt = now
    this.state.history.push({
      at: now,
      payment: this.state.paymentStatus,
      fulfillment: this.state.fulfillmentStatus,
      actor,
    })
  }

  changeFulfillment(next: FulfillmentStatus, now: string, actor: string | number = 'system') {
    if (next === this.state.fulfillmentStatus) return
    if (!transitions[this.state.fulfillmentStatus].includes(next))
      throw new OrderError('transition', 'Transition de réalisation refusée.')
    if (next !== 'cancelled' && !['paid', 'partially_refunded'].includes(this.state.paymentStatus))
      throw new OrderError('payment_required', 'Un paiement confirmé est requis.')
    this.state.fulfillmentStatus = next
    if (next === 'shipped') this.state.shippedAt = now
    this.record(now, actor)
    this.events.push({
      type: 'OrderFulfillmentChanged',
      orderId: this.state.id,
      reference: this.state.reference,
      occurredAt: now,
      status: next,
      paid: ['paid', 'partially_refunded', 'refunded'].includes(this.state.paymentStatus),
    })
  }

  amendAdministration(
    change: {
      fulfillmentStatus?: FulfillmentStatus
      trackingNumber?: string | null
      internalNote?: string | null
    },
    now: string,
    actor: string | number,
  ) {
    // Only administrators come through here: the system's own transitions (payment confirmation,
    // expiry, refunds) call changeFulfillment directly and keep working on unpaid orders.
    if (
      change.fulfillmentStatus &&
      change.fulfillmentStatus !== this.state.fulfillmentStatus &&
      !['paid', 'partially_refunded'].includes(this.state.paymentStatus)
    )
      throw new OrderError(
        'payment_required',
        'Le paiement doit être confirmé (Payé) avant de changer la réalisation.',
      )
    if (change.fulfillmentStatus) this.changeFulfillment(change.fulfillmentStatus, now, actor)
    if (change.trackingNumber !== undefined) {
      if (change.trackingNumber && change.trackingNumber.length > 150)
        throw new OrderError('tracking')
      this.state.trackingNumber = change.trackingNumber
    }
    if (change.internalNote !== undefined) this.state.internalNote = change.internalNote
    this.state.updatedAt = now
  }

  attachPaymentSession(id: string, now: string) {
    if (this.state.paymentSessionId && this.state.paymentSessionId !== id)
      throw new OrderError('payment_mismatch')
    this.state.paymentSessionId = id
    this.state.updatedAt = now
  }

  canRetryPayment(now: Date): boolean {
    return (
      this.state.fulfillmentStatus === 'awaiting_payment' &&
      ['pending', 'failed', 'expired'].includes(this.state.paymentStatus) &&
      this.state.paymentSessionId !== null &&
      this.paymentRetryDeadline > now.getTime() + PAYMENT_WINDOW_MS
    )
  }

  get paymentRetryDeadline(): number {
    return Date.parse(this.state.createdAt) + PAYMENT_RETRY_WINDOW_MS
  }

  replaceExpiredPayment(previousId: string, newId: string, now: Date) {
    if (!this.canRetryPayment(now) || this.state.paymentSessionId !== previousId)
      throw new OrderError('expired')
    if (previousId === newId) throw new OrderError('payment_mismatch')
    this.state.paymentSessionId = newId
    this.state.paymentId = null
    this.state.paymentExpiresAt = new Date(this.paymentRetryDeadline).toISOString()
    this.state.paymentStatus = 'pending'
    this.record(now.toISOString())
  }

  receivePayment(update: PaymentUpdate, now: string) {
    if (
      update.amount !== this.state.totalCents ||
      update.currency.toUpperCase() !== this.state.currency
    )
      throw new OrderError('payment_mismatch', 'Montant de paiement incompatible avec la commande.')
    if (
      update.sessionId &&
      this.state.paymentSessionId &&
      update.sessionId !== this.state.paymentSessionId
    ) {
      // An old unsuccessful attempt must not change the new payment's status.
      if (update.state === 'expired' || update.state === 'failed') return
      throw new OrderError('payment_mismatch')
    }
    if (update.paymentId && this.state.paymentId && update.paymentId !== this.state.paymentId)
      throw new OrderError('payment_mismatch')
    if (
      update.state === 'paid' &&
      !['paid', 'partially_refunded', 'refunded'].includes(this.state.paymentStatus)
    ) {
      this.state.paymentStatus = 'paid'
      this.state.paidAt = update.paidAt || now
      if (update.sessionId) this.state.paymentSessionId = update.sessionId
      if (update.paymentId) this.state.paymentId = update.paymentId
      if (this.state.fulfillmentStatus === 'awaiting_payment') this.changeFulfillment('queued', now)
      if (this.state.fulfillmentStatus === 'cancelled')
        this.state.internalNote =
          'Paiement reçu après annulation : remboursement manuel nécessaire dans le service de paiement.'
      this.record(now)
      this.events.push({
        type: 'OrderPaymentConfirmed',
        orderId: this.state.id,
        reference: this.state.reference,
        occurredAt: now,
      })
    } else if (
      ['refunded', 'partially_refunded'].includes(update.state) &&
      ['paid', 'partially_refunded'].includes(this.state.paymentStatus)
    ) {
      this.state.paymentStatus = update.state
      if (
        update.state === 'refunded' &&
        ['queued', 'in_progress', 'ready'].includes(this.state.fulfillmentStatus)
      )
        this.changeFulfillment('cancelled', now)
      this.record(now)
      this.events.push({
        type: 'OrderRefunded',
        orderId: this.state.id,
        reference: this.state.reference,
        occurredAt: now,
        eventId: update.eventId,
      })
    } else if (
      ['failed', 'expired'].includes(update.state) &&
      this.state.paymentStatus === 'pending'
    ) {
      this.state.paymentStatus = update.state
      this.record(now)
    }
  }

  expirePayment(now: string) {
    if (this.state.paymentStatus === 'pending' && this.state.paymentExpiresAt < now) {
      this.state.paymentStatus = 'expired'
      this.record(now)
    }
  }

  /** Extension-owned data; `event` becomes an OrderExtensionEvent. Returns false when nothing changed. */
  amendDetails(next: D, now: string, event?: { notice: string; key: string }): boolean {
    if (JSON.stringify(next) === JSON.stringify(this.state.details)) return false
    this.state.details = structuredClone(next)
    this.state.updatedAt = now
    if (event)
      this.events.push({
        type: 'OrderExtensionEvent',
        orderId: this.state.id,
        reference: this.state.reference,
        occurredAt: now,
        notice: event.notice,
        key: event.key,
      })
    return true
  }

  /** A checkout retried with the same attempt id must still be payable and unchanged. */
  sameAttempt(customer: Customer, comment: string, now: string) {
    if (this.state.paymentStatus !== 'pending' || this.state.paymentExpiresAt <= now)
      throw new OrderError('expired')
    if (
      this.state.customerComment !== comment ||
      JSON.stringify(this.state.customer) !== JSON.stringify(customer)
    )
      throw new OrderError('attempt')
  }
}
