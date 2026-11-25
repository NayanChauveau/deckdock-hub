import type { Customer, Language } from './value-objects'

export type PaymentStatus =
  'pending' | 'paid' | 'failed' | 'expired' | 'partially_refunded' | 'refunded'
export type FulfillmentStatus =
  'awaiting_payment' | 'queued' | 'in_progress' | 'ready' | 'shipped' | 'cancelled'
export type OrderId = number

/** What an extension (the module that sells something) stores on its orders. */
export type OrderDetails = Readonly<Record<string, unknown>>

/** One priced line of the order (what is sold, as shown to the customer). */
export interface OrderLine {
  label: string
  unitCents: number
  quantity: number
}

export interface HistoryEntry {
  at: string
  action?: string
  payment?: PaymentStatus
  fulfillment?: FulfillmentStatus
  actor?: string | number
}

/** Persistence-neutral state of an order. Provider IDs are opaque. */
export interface OrderSnapshot<D extends OrderDetails = OrderDetails> {
  id: OrderId
  reference: string
  attemptId: string
  locale: Language
  /** The extension that sells this order's item (e.g. "drawing"). */
  kind: string
  customer: Customer
  lines: OrderLine[]
  itemsCents: number
  shippingCents: number
  totalCents: number
  currency: 'EUR'
  paymentStatus: PaymentStatus
  fulfillmentStatus: FulfillmentStatus
  paymentSessionId: string | null
  paymentId: string | null
  paymentExpiresAt: string
  paidAt: string | null
  shippedAt: string | null
  trackingNumber: string | null
  customerComment: string
  internalNote: string | null
  /** Terms of sale accepted at checkout; null only for orders placed before acceptance was recorded. */
  termsVersion: string | null
  termsAcceptedAt: string | null
  history: HistoryEntry[]
  details: D
  createdAt: string
  updatedAt: string
}

export type OrderEvent =
  | { type: 'OrderPaymentConfirmed'; orderId: OrderId; reference: string; occurredAt: string }
  | {
      type: 'OrderFulfillmentChanged'
      orderId: OrderId
      reference: string
      occurredAt: string
      status: FulfillmentStatus
      paid: boolean
    }
  | {
      type: 'OrderRefunded'
      orderId: OrderId
      reference: string
      occurredAt: string
      eventId: string
    }
  | {
      /** Raised by an extension through Order.amendDetails (e.g. a changed delivery estimate). */
      type: 'OrderExtensionEvent'
      orderId: OrderId
      reference: string
      occurredAt: string
      notice: string
      key: string
    }

export interface PaymentUpdate {
  eventId: string
  eventType: string
  reference?: string
  sessionId?: string
  paymentId?: string
  amount: number
  currency: string
  state: 'paid' | 'failed' | 'expired' | 'refunded' | 'partially_refunded'
  paidAt?: string
}

export interface Notification {
  id: number
  key: string
  orderId: OrderId
  /** confirmation, shipped, cancelled, refunded, owner_new_order, or a kind owned by an extension. */
  kind: string
  status: 'pending' | 'sent' | 'simulated' | 'failed'
  attempts: number
  nextAttemptAt: string
  sentAt: string | null
  lastError: string | null
  subject: string | null
  body: string | null
}
