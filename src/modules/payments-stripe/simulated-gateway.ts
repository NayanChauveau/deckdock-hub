import { OrderError } from '../orders/domain/errors'
import type { OrderSnapshot } from '../orders/domain/model'
import type { PaymentGateway, PaymentMode, PaymentSession } from '../orders/application/ports'
import { trackingPath } from '../orders/paths'

/** Local development only: the "payment page" is the tracking page, paid with a button there. */
export class SimulatedPaymentGateway implements PaymentGateway {
  mode(): PaymentMode {
    return 'simulation'
  }
  createSession(order: OrderSnapshot): Promise<PaymentSession> {
    return Promise.resolve({
      id: `simulated:${order.reference}`,
      reference: order.reference,
      amount: order.totalCents,
      currency: order.currency,
      paid: false,
      expired: false,
      open: true,
      url: trackingPath(order.locale, order.reference),
    })
  }
  readSession(): Promise<PaymentSession> {
    return Promise.reject(new OrderError('payment_unavailable'))
  }
  verifyNotification(): Promise<null> {
    return Promise.reject(new OrderError('webhook_unavailable'))
  }
}
