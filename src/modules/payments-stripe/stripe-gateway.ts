import Stripe from 'stripe'
import { OrderError } from '../orders/domain/errors'
import type { OrderSnapshot, PaymentUpdate } from '../orders/domain/model'
import type { PaymentGateway, PaymentMode, PaymentSession } from '../orders/application/ports'
import { checkoutReturn } from '../orders/paths'

/** One Checkout item per order line, then shipping when there is any. */
export function lineItems(order: OrderSnapshot) {
  const item = (name: string, unitAmount: number, quantity: number) => ({
    price_data: { currency: 'eur', unit_amount: unitAmount, product_data: { name } },
    quantity,
  })
  return [
    ...order.lines.map((line) => item(line.label, line.unitCents, line.quantity)),
    ...(order.shippingCents
      ? [item(order.locale === 'fr' ? 'Livraison' : 'Delivery', order.shippingCents, 1)]
      : []),
  ]
}

function sessionView(session: Stripe.Checkout.Session): PaymentSession {
  const paymentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id
  return {
    id: session.id,
    reference: session.metadata?.['reference'] || null,
    ...(paymentId ? { paymentId } : {}),
    amount: session.amount_total ?? 0,
    currency: session.currency || '',
    paid: session.payment_status === 'paid',
    expired: session.status === 'expired',
    open: session.status === 'open',
    url: session.url,
  }
}
export class StripeGateway implements PaymentGateway {
  private client: Stripe
  constructor(
    key: string,
    private webhookSecret: string,
    private origin: string,
    private stripeMode: 'test' | 'live' = 'test',
  ) {
    if (!key.startsWith(`sk_${stripeMode}_`) && !key.startsWith(`rk_${stripeMode}_`))
      throw new Error('Clé Stripe incompatible avec le mode actif.')
    if (!webhookSecret.startsWith('whsec_')) throw new Error('Secret webhook Stripe requis.')
    this.client = new Stripe(key, { maxNetworkRetries: 2, timeout: 15000 })
  }
  mode(): PaymentMode {
    return this.stripeMode === 'live' ? 'live' : 'sandbox'
  }
  async createSession(order: OrderSnapshot, replacesSessionId?: string) {
    const returns = checkoutReturn(order.locale, order.reference)
    return sessionView(
      await this.client.checkout.sessions.create(
        {
          mode: 'payment',
          allowed_payment_method_types: ['card'],
          locale: order.locale,
          client_reference_id: order.reference,
          customer_email: order.customer.email,
          metadata: { reference: order.reference },
          payment_intent_data: {
            description: `${order.locale === 'fr' ? 'Commande' : 'Order'} ${order.reference}`,
            metadata: { reference: order.reference },
          },
          expires_at: Math.floor(Date.parse(order.paymentExpiresAt) / 1000),
          success_url: this.origin + returns.success,
          cancel_url: this.origin + returns.cancel,
          line_items: lineItems(order),
        },
        {
          idempotencyKey: replacesSessionId
            ? `checkout:${order.reference}:retry:${replacesSessionId}`
            : `checkout:${order.reference}`,
        },
      ),
    )
  }
  async readSession(id: string) {
    return sessionView(await this.client.checkout.sessions.retrieve(id))
  }
  async verifyNotification(body: Uint8Array, signature: string): Promise<PaymentUpdate | null> {
    if (!this.webhookSecret) throw new OrderError('webhook_unavailable')
    let event: Stripe.Event
    try {
      event = this.client.webhooks.constructEvent(Buffer.from(body), signature, this.webhookSecret)
    } catch {
      throw new OrderError('signature')
    }
    if (event.livemode !== (this.stripeMode === 'live'))
      throw new OrderError('payment_mode_mismatch')
    if (
      [
        'checkout.session.completed',
        'checkout.session.async_payment_succeeded',
        'checkout.session.async_payment_failed',
        'checkout.session.expired',
      ].includes(event.type)
    ) {
      const session = await this.readSession((event.data.object as Stripe.Checkout.Session).id)
      if (!session.reference) return null
      const state = session.paid
        ? 'paid'
        : event.type === 'checkout.session.expired'
          ? 'expired'
          : event.type === 'checkout.session.async_payment_failed'
            ? 'failed'
            : null
      return state
        ? {
            eventId: event.id,
            eventType: event.type,
            reference: session.reference,
            sessionId: session.id,
            ...(session.paymentId ? { paymentId: session.paymentId } : {}),
            amount: session.amount,
            currency: session.currency,
            state,
            paidAt: new Date(event.created * 1000).toISOString(),
          }
        : null
    }
    if (event.type === 'charge.refunded') {
      const charge = event.data.object
      const paymentId =
        typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id
      return paymentId
        ? {
            eventId: event.id,
            eventType: event.type,
            paymentId,
            amount: charge.amount,
            currency: charge.currency,
            state: charge.amount_refunded >= charge.amount ? 'refunded' : 'partially_refunded',
          }
        : null
    }
    return null
  }
}
