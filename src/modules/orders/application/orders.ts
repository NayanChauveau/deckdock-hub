import { OrderError } from '../domain/errors'
import type { FulfillmentStatus, OrderDetails, OrderEvent, OrderSnapshot } from '../domain/model'
import type { AccessOrder } from './access'
import type { OrderExtension } from './extension'
import { dispatchOrderEvents } from './notifications'
import { canRetry } from './payments'
import type { Clock, PaymentGateway, UnitOfWork } from './ports'

/** What the customer's private tracking page may show; `details` comes from the extension. */
export const orderView = (order: OrderSnapshot) => ({
  reference: order.reference,
  kind: order.kind,
  paymentStatus: order.paymentStatus,
  fulfillmentStatus: order.fulfillmentStatus,
  lines: order.lines,
  itemsCents: order.itemsCents,
  shippingCents: order.shippingCents,
  totalCents: order.totalCents,
  trackingNumber: order.trackingNumber,
})

export class ReadOrders<D extends OrderDetails, X> {
  constructor(
    private uow: UnitOfWork<D, X>,
    private access: AccessOrder,
    private payments: PaymentGateway,
    private clock: Clock,
    private extension: OrderExtension<D, X>,
  ) {}
  async tracking(reference: string, token: string | null | undefined) {
    this.access.authorize(reference, token)
    const order = await this.uow.read((tx) => tx.orders.findByReference(reference))
    if (!order) throw new OrderError('not_found')
    const mode = this.payments.mode()
    const snapshot = order.snapshot
    return {
      ...orderView(snapshot),
      details: this.extension.trackingView?.(snapshot) ?? {},
      simulated: mode === 'simulation',
      canRetry:
        (mode === 'sandbox' || mode === 'live') &&
        canRetry(order, this.clock.now(), this.extension),
    }
  }
}

export interface AdminChange {
  fulfillmentStatus?: FulfillmentStatus
  trackingNumber?: string | null
  internalNote?: string | null
}

export class AdministerOrder<D extends OrderDetails, X> {
  constructor(
    private uow: UnitOfWork<D, X>,
    private clock: Clock,
    private extension: OrderExtension<D, X>,
  ) {}
  /** For an admin save hook: validates the change; the caller persists, then calls complete. */
  async prepare(id: number, change: AdminChange, actor: number | string) {
    return this.uow.run(async (tx) => {
      const order = await tx.orders.findById(id)
      if (!order) throw new OrderError('not_found')
      order.amendAdministration(change, this.clock.now().toISOString(), actor)
      return { snapshot: order.snapshot, events: order.releaseEvents() }
    })
  }
  async complete(events: readonly OrderEvent[]) {
    return this.uow.run((tx) => dispatchOrderEvents(events, tx, this.extension))
  }
  async execute(id: number, change: AdminChange, actor: number | string) {
    return this.uow.run(async (tx) => {
      const order = await tx.orders.findById(id)
      if (!order) throw new OrderError('not_found')
      order.amendAdministration(change, this.clock.now().toISOString(), actor)
      await tx.orders.save(order)
      await dispatchOrderEvents(order.releaseEvents(), tx, this.extension)
      return order.snapshot
    })
  }
}
