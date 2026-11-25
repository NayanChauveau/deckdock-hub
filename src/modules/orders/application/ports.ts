import { OrderError } from '../domain/errors'
import type { Order } from '../domain/order'
import type {
  Notification,
  OrderDetails,
  OrderId,
  OrderSnapshot,
  PaymentUpdate,
} from '../domain/model'
import type { Country } from '../domain/value-objects'
import type { EmailDocument } from './email-document'
export type { EmailBrand } from './email-document'

/** Ports belong to the application. Implementations live exclusively outside the hexagon. */
export interface Clock {
  now(): Date
}
export interface Identifiers {
  orderReference(): string
  /** The site's exact reference shape (its prefix), checked before any lookup. */
  isOrderReference(value: string): boolean
}
export interface Signer {
  sign(value: string): string
  orderToken(reference: string): string
  verifyOrderToken(reference: string, token: string | null | undefined): boolean
}
export interface OrderRepository<D extends OrderDetails = OrderDetails> {
  findById(id: OrderId): Promise<Order<D> | null>
  findByReference(reference: string): Promise<Order<D> | null>
  findByAttempt(attemptId: string): Promise<Order<D> | null>
  findByPayment(paymentId: string): Promise<Order<D> | null>
  create(order: Order<D>): Promise<Order<D>>
  save(order: Order<D>): Promise<void>
  unconfirmedPayments(limit: number): Promise<Order<D>[]>
  expiredPayments(now: string, limit: number): Promise<Order<D>[]>
}
export interface PaymentEventRepository {
  has(id: string): Promise<boolean>
  record(event: PaymentUpdate, orderId: OrderId): Promise<void>
}
export interface NotificationRepository {
  /** Ignored when a notice with the same key exists: keys make every notice idempotent. */
  enqueue(orderId: OrderId, key: string, kind: string, now: string): Promise<void>
  ready(now: string, limit: number): Promise<Notification[]>
  find(id: number): Promise<Notification | null>
  save(notice: Notification): Promise<void>
}
export interface RateLimitRepository {
  removeExpired(now: string): Promise<void>
}
export interface OrderSettings {
  enabled: boolean
  countries: Country[]
  ownerEmail: string | null
}
export interface OrderTransaction<D extends OrderDetails = OrderDetails> {
  orders: OrderRepository<D>
  paymentEvents: PaymentEventRepository
  notifications: NotificationRepository
  rateLimits: RateLimitRepository
  settings(): Promise<OrderSettings>
  termsVersion(): Promise<string>
}
/** X: the repositories the extension adds to the same transaction. */
export type Transaction<D extends OrderDetails = OrderDetails, X = object> = OrderTransaction<D> & X
export interface UnitOfWork<D extends OrderDetails = OrderDetails, X = object> {
  run<T>(work: (tx: Transaction<D, X>) => Promise<T>): Promise<T>
  read<T>(work: (tx: Transaction<D, X>) => Promise<T>): Promise<T>
}
export type PaymentMode = 'simulation' | 'sandbox' | 'live' | 'disabled'
export interface PaymentSession {
  id: string
  reference: string | null
  paymentId?: string
  amount: number
  currency: string
  paid: boolean
  expired: boolean
  url: string | null
  open: boolean
}
export interface PaymentGateway {
  mode(): PaymentMode
  createSession(order: OrderSnapshot, replacesSessionId?: string): Promise<PaymentSession>
  readSession(id: string): Promise<PaymentSession>
  verifyNotification(body: Uint8Array, signature: string): Promise<PaymentUpdate | null>
}
/** A site without a payment module: orders can exist, no payment can be opened. */
export class DisabledPaymentGateway implements PaymentGateway {
  mode(): PaymentMode {
    return 'disabled'
  }
  createSession(): Promise<PaymentSession> {
    return Promise.reject(new OrderError('payment_unavailable'))
  }
  readSession(): Promise<PaymentSession> {
    return Promise.reject(new OrderError('payment_unavailable'))
  }
  verifyNotification(_body: Uint8Array, _signature: string): Promise<PaymentUpdate | null> {
    return Promise.reject(new OrderError('webhook_unavailable'))
  }
}
export interface OrderLinks {
  tracking(order: OrderSnapshot): string
  admin(order: OrderSnapshot): string
  /** Public pages in the order's language, quoted in customer emails. */
  home(order: OrderSnapshot): string
  terms(order: OrderSnapshot): string
}
/** An email to send, as content; `to` defaults to the customer, internal notices name theirs. */
export interface EmailMessage {
  subject: string
  document: EmailDocument
  to?: string
}
/** What a delivery did, with the plain text it rendered (kept in the outbox when simulated). */
export interface Delivery {
  status: 'sent' | 'simulated'
  text: string
}
/** Renders the message (HTML and plain text) and sends it, or only renders it when simulated. */
export interface Mailer {
  deliver(order: OrderSnapshot, notice: Notification, message: EmailMessage): Promise<Delivery>
}
export interface TrafficLimiter {
  consume(identity: string, action: string, maximum: number, now: Date): Promise<void>
}
