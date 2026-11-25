import { OrderError } from '../domain/errors'
import type { OrderDetails, PaymentUpdate } from '../domain/model'
import type { Order } from '../domain/order'
import type { OrderExtension } from './extension'
import { dispatchOrderEvents } from './notifications'
import type { AccessOrder } from './access'
import type { Clock, PaymentGateway, UnitOfWork } from './ports'

/** Whether a failed or expired payment can be opened again, for the domain and the extension. */
export function canRetry<D extends OrderDetails, X>(
  order: Order<D>,
  now: Date,
  extension: OrderExtension<D, X>,
) {
  return order.canRetryPayment(now) && (extension.canRetryPayment?.(order.snapshot) ?? true)
}

export class ProcessPayment<D extends OrderDetails, X> {
  constructor(
    private uow: UnitOfWork<D, X>,
    private clock: Clock,
    private gateway: PaymentGateway,
    private access: AccessOrder,
    private extension: OrderExtension<D, X>,
  ) {}

  async handleWebhook(body: Uint8Array, signature: string) {
    const update = await this.gateway.verifyNotification(body, signature)
    if (update) await this.applyVerified(update)
  }

  /** Idempotent on the provider's event id; an unknown order is acknowledged and ignored. */
  async applyVerified(update: PaymentUpdate) {
    await this.uow.run(async (tx) => {
      if (await tx.paymentEvents.has(update.eventId)) return
      const order = update.reference
        ? await tx.orders.findByReference(update.reference)
        : await tx.orders.findByPayment(update.paymentId || 'missing')
      if (!order) return
      order.receivePayment(update, this.clock.now().toISOString())
      await tx.paymentEvents.record(update, order.snapshot.id)
      await tx.orders.save(order)
      await dispatchOrderEvents(order.releaseEvents(), tx, this.extension)
    })
  }

  async retry(reference: string, token: string | null | undefined) {
    this.access.authorize(reference, token)
    if (!['sandbox', 'live'].includes(this.gateway.mode()))
      throw new OrderError('payment_unavailable')
    return this.uow.run(async (tx) => {
      const order = await tx.orders.findByReference(reference)
      if (!order) throw new OrderError('not_found')
      const now = this.clock.now()
      const snapshot = order.snapshot
      if (!canRetry(order, now, this.extension) || !snapshot.paymentSessionId)
        throw new OrderError('expired')
      const previous = await this.gateway.readSession(snapshot.paymentSessionId)
      if (
        previous.id !== snapshot.paymentSessionId ||
        previous.reference !== reference ||
        previous.amount !== snapshot.totalCents ||
        previous.currency.toUpperCase() !== snapshot.currency
      )
        throw new OrderError('payment_mismatch')
      if (previous.paid) return { url: null }
      if (previous.open && previous.url) return { url: previous.url }
      // A closed payment can still be processing. Only replace a confirmed expired one.
      if (!previous.expired) throw new OrderError('payment_state')
      if (!(await tx.settings()).enabled) throw new OrderError('closed')
      const session = await this.gateway.createSession(
        { ...snapshot, paymentExpiresAt: new Date(order.paymentRetryDeadline).toISOString() },
        previous.id,
      )
      if (!session.open || !session.url) throw new OrderError('expired')
      order.replaceExpiredPayment(previous.id, session.id, now)
      await tx.orders.save(order)
      return { url: session.url }
    })
  }

  /** Local simulation only: pays the order as a provider notification would. */
  async simulate(reference: string, token: string | null | undefined) {
    if (this.gateway.mode() !== 'simulation') throw new OrderError('not_found')
    this.access.authorize(reference, token)
    const order = await this.uow.read((tx) => tx.orders.findByReference(reference))
    if (!order || order.snapshot.paymentExpiresAt < this.clock.now().toISOString())
      throw new OrderError('expired')
    const data = order.snapshot
    await this.applyVerified({
      eventId: `simulated:${reference}`,
      eventType: 'local.simulated',
      reference,
      amount: data.totalCents,
      currency: data.currency,
      state: 'paid',
    })
  }
}
