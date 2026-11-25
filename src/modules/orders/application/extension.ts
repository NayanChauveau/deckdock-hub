import type { OrderDetails, OrderEvent, OrderSnapshot } from '../domain/model'
import type { Language } from '../domain/value-objects'
import type { EmailBrand, EmailMessage, OrderLinks, Transaction } from './ports'

/** What the module that sells something plugs into the generic order flow. Every hook is optional. */
export interface OrderExtension<D extends OrderDetails = OrderDetails, X = object> {
  /** Stored on each order as `kind`. */
  kind: string
  /** After order events became notices, in the same transaction (e.g. to recalculate a production schedule). */
  afterEvents?(events: readonly OrderEvent[], tx: Transaction<D, X>): Promise<void>
  canRetryPayment?(order: OrderSnapshot<D>): boolean
  trackingView?(order: OrderSnapshot<D>): Record<string, unknown>
  /** Rows added to the summary of every order email. */
  emailRows?(order: OrderSnapshot<D>, locale: Language): (readonly [string, string])[]
  /** Whole email for a notice kind; null for kinds it leaves to the generic copy. */
  emailFor?(
    order: OrderSnapshot<D>,
    notice: string,
    links: OrderLinks,
    brand: EmailBrand,
  ): EmailMessage | null
  /** End of the maintenance job, outside any transaction. */
  maintain?(): Promise<void>
}

/** Orders that need nothing beyond lines and a price. */
export const plainOrders: OrderExtension = { kind: 'plain' }
