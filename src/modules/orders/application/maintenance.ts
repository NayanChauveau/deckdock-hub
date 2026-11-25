import type { OrderDetails } from '../domain/model'
import type { OrderExtension } from './extension'
import { emailContent, isOrderNotice, OWNER_NOTICE, ownerEmailContent } from './notifications'
import type { ProcessPayment } from './payments'
import type { Clock, EmailBrand, Mailer, OrderLinks, PaymentGateway, UnitOfWork } from './ports'

/** The periodic job: reconcile payments, expire unpaid orders, deliver the outbox, then the extension. */
export class MaintainOrders<D extends OrderDetails, X> {
  constructor(
    private uow: UnitOfWork<D, X>,
    private clock: Clock,
    private gateway: PaymentGateway,
    private payments: ProcessPayment<D, X>,
    private mailer: Mailer,
    private links: OrderLinks,
    private brand: EmailBrand,
    private extension: OrderExtension<D, X>,
  ) {}

  async execute() {
    await this.reconcile()
    await this.uow.run(async (tx) => {
      const now = this.clock.now().toISOString()
      for (const order of await tx.orders.expiredPayments(now, 100)) {
        order.expirePayment(now)
        await tx.orders.save(order)
      }
      await tx.rateLimits.removeExpired(now)
    })
    const notices = await this.uow.read((tx) =>
      tx.notifications.ready(this.clock.now().toISOString(), 10),
    )
    for (const notice of notices) await this.deliver(notice.id)
    await this.extension.maintain?.()
  }

  /** A payment confirmed by the provider but whose notification was lost is applied here. */
  private async reconcile() {
    const unconfirmed = await this.uow.read((tx) => tx.orders.unconfirmedPayments(50))
    for (const aggregate of unconfirmed) {
      const order = aggregate.snapshot
      if (!order.paymentSessionId) continue
      try {
        const session = await this.gateway.readSession(order.paymentSessionId)
        if (session.paid && session.reference === order.reference)
          await this.payments.applyVerified({
            eventId: `reconcile:${session.id}:paid`,
            eventType: 'checkout.reconciled',
            reference: order.reference,
            sessionId: session.id,
            ...(session.paymentId ? { paymentId: session.paymentId } : {}),
            amount: session.amount,
            currency: session.currency,
            state: 'paid',
          })
      } catch {
        /* An uncertain provider state is retried on the next run. */
      }
    }
  }

  private async deliver(id: number) {
    await this.uow.run(async (tx) => {
      const notice = await tx.notifications.find(id)
      const now = this.clock.now().toISOString()
      if (!notice || !['pending', 'failed'].includes(notice.status) || notice.nextAttemptAt > now)
        return
      const order = await tx.orders.findById(notice.orderId)
      if (!order) return
      const snapshot = order.snapshot
      // Leave a trace in the outbox instead of retrying forever when nothing can be sent.
      const skip = async (reason: string) => {
        notice.status = 'simulated'
        notice.lastError = reason
        await tx.notifications.save(notice)
      }
      let message = this.extension.emailFor?.(snapshot, notice.kind, this.links, this.brand)
      if (!message && notice.kind === OWNER_NOTICE) {
        const owner = (await tx.settings()).ownerEmail
        if (!owner) return skip('Aucun email interne configuré.')
        message = ownerEmailContent(snapshot, this.links, owner, this.brand, this.extension)
      }
      if (!message && isOrderNotice(notice.kind))
        message = emailContent(snapshot, notice.kind, this.links, this.brand, this.extension)
      if (!message) return skip('Aucun modèle d’email pour ce type de notification.')
      notice.attempts++
      try {
        const delivery = await this.mailer.deliver(snapshot, notice, message)
        notice.status = delivery.status
        notice.sentAt = this.clock.now().toISOString()
        notice.lastError = null
        if (notice.status === 'simulated') {
          notice.subject = message.subject
          notice.body = delivery.text
        }
      } catch {
        notice.status = 'failed'
        notice.lastError = 'Envoi indisponible ; vérifier la configuration du service email.'
        notice.nextAttemptAt = new Date(
          this.clock.now().getTime() +
            Math.min(3600, 60 * 2 ** Math.min(notice.attempts, 6)) * 1000,
        ).toISOString()
      }
      await tx.notifications.save(notice)
    })
  }
}
