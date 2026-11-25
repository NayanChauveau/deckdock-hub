import type { Payload, PayloadRequest, RequiredDataFromCollectionSlug, Where } from 'payload'
import type { EmailOutbox } from '@/payload-types'
import type {
  NotificationRepository,
  OrderRepository,
  PaymentEventRepository,
  RateLimitRepository,
} from '../../application/ports'
import type { Notification, OrderDetails, PaymentUpdate } from '../../domain/model'
import type { Order } from '../../domain/order'
import { countryName } from '@/core/domain/countries'
import { orderFromDoc, orderToDoc } from './mapper'
import type { OrderPersistenceExtension } from './persistence-extension'

/** Payload hooks are an incoming adapter; repository writes must not re-enter it. */
export class PayloadRepository {
  constructor(
    protected payload: Payload,
    protected req?: PayloadRequest,
  ) {}
  protected async internal<T>(work: () => Promise<T>): Promise<T> {
    const context = this.req?.context
    try {
      return await work()
    } finally {
      if (this.req && context) this.req.context = context
    }
  }
  protected get requestOptions() {
    return this.req ? { req: this.req } : {}
  }
  protected get writeContext() {
    return { ordersPersistence: true }
  }
}

/** Reads of `orders` as aggregates of the registered extension. */
export class PayloadOrderQueries<D extends OrderDetails, X> extends PayloadRepository {
  constructor(
    payload: Payload,
    req: PayloadRequest | undefined,
    protected extension: OrderPersistenceExtension<D, X>,
  ) {
    super(payload, req)
  }
  protected async first(where: Where): Promise<Order<D> | null> {
    const doc = (
      await this.payload.find({
        collection: 'orders',
        where,
        limit: 1,
        depth: 0,
        showHiddenFields: true,
        ...this.requestOptions,
      })
    ).docs[0]
    return doc ? orderFromDoc(doc, this.extension) : null
  }
  async list(where: Where, limit?: number, sort?: string[]): Promise<Order<D>[]> {
    const result = await this.payload.find({
      collection: 'orders',
      where,
      depth: 0,
      showHiddenFields: true,
      ...this.requestOptions,
      ...(limit ? { limit } : { pagination: false }),
      ...(sort ? { sort } : {}),
    })
    return result.docs.map((doc) => orderFromDoc(doc, this.extension))
  }
}

export class PayloadOrders<D extends OrderDetails, X>
  extends PayloadOrderQueries<D, X>
  implements OrderRepository<D>
{
  /** The collection's own columns: the generic ones plus the extension's fields. */
  private columns(order: Order<D>) {
    return orderToDoc(order.snapshot, this.extension) as RequiredDataFromCollectionSlug<'orders'>
  }
  findById(id: number) {
    return this.first({ id: { equals: id } })
  }
  findByReference(reference: string) {
    return this.first({ reference: { equals: reference } })
  }
  findByAttempt(attemptId: string) {
    return this.first({ attemptId: { equals: attemptId } })
  }
  findByPayment(id: string) {
    return this.first({ paymentId: { equals: id } })
  }
  async create(order: Order<D>) {
    const doc = await this.internal(() =>
      this.payload.create({
        collection: 'orders',
        showHiddenFields: true,
        data: this.columns(order),
        ...this.requestOptions,
        context: this.writeContext,
      }),
    )
    return orderFromDoc(doc, this.extension)
  }
  async save(order: Order<D>) {
    await this.internal(() =>
      this.payload.update({
        collection: 'orders',
        id: order.snapshot.id,
        data: this.columns(order),
        ...this.requestOptions,
        context: this.writeContext,
      }),
    )
  }
  unconfirmedPayments(limit: number) {
    return this.list(
      {
        paymentStatus: { in: ['pending', 'expired', 'failed'] },
        paymentSessionId: { exists: true },
      },
      limit,
      ['updatedAt'],
    )
  }
  expiredPayments(now: string, limit: number) {
    return this.list(
      { paymentStatus: { equals: 'pending' }, paymentExpiresAt: { less_than: now } },
      limit,
    )
  }
}

export class PayloadPaymentEvents extends PayloadRepository implements PaymentEventRepository {
  async has(id: string) {
    return (
      (
        await this.payload.count({
          collection: 'payment-events',
          where: { eventId: { equals: id } },
          ...this.requestOptions,
        })
      ).totalDocs > 0
    )
  }
  async record(event: PaymentUpdate, orderId: number) {
    await this.payload.create({
      collection: 'payment-events',
      data: { eventId: event.eventId, eventType: event.eventType, order: orderId },
      ...this.requestOptions,
    })
  }
}

function noticeFromPayload(doc: EmailOutbox): Notification {
  return {
    id: doc.id,
    key: doc.key,
    orderId: typeof doc.order === 'number' ? doc.order : doc.order.id,
    kind: doc.kind,
    status: doc.status,
    attempts: doc.attempts,
    nextAttemptAt: doc.nextAttemptAt,
    sentAt: doc.sentAt || null,
    lastError: doc.lastError || null,
    subject: doc.subject || null,
    body: doc.body || null,
  }
}

export class PayloadNotifications extends PayloadRepository implements NotificationRepository {
  async enqueue(orderId: number, key: string, kind: string, now: string) {
    if (
      (
        await this.payload.count({
          collection: 'email-outbox',
          where: { key: { equals: key } },
          ...this.requestOptions,
        })
      ).totalDocs
    )
      return
    await this.payload.create({
      collection: 'email-outbox',
      // `kind` options are the generic notices plus the extension's (collections.ts).
      data: {
        order: orderId,
        key,
        kind: kind as EmailOutbox['kind'],
        status: 'pending',
        attempts: 0,
        nextAttemptAt: now,
      },
      ...this.requestOptions,
    })
  }
  async ready(now: string, limit: number) {
    return (
      await this.payload.find({
        collection: 'email-outbox',
        where: { status: { in: ['pending', 'failed'] }, nextAttemptAt: { less_than_equal: now } },
        sort: 'createdAt',
        limit,
        depth: 0,
        ...this.requestOptions,
      })
    ).docs.map(noticeFromPayload)
  }
  async find(id: number) {
    const doc = (
      await this.payload.find({
        collection: 'email-outbox',
        where: { id: { equals: id } },
        limit: 1,
        depth: 0,
        ...this.requestOptions,
      })
    ).docs[0]
    return doc ? noticeFromPayload(doc) : null
  }
  async save(notice: Notification) {
    const { orderId, kind, ...data } = notice
    await this.payload.update({
      collection: 'email-outbox',
      id: notice.id,
      data: { ...data, kind: kind as EmailOutbox['kind'], order: orderId },
      ...this.requestOptions,
    })
  }
}

export class PayloadRateLimits extends PayloadRepository implements RateLimitRepository {
  async removeExpired(now: string) {
    await this.payload.delete({
      collection: 'commerce-rate-limits',
      where: { expiresAt: { less_than: now } },
      ...this.requestOptions,
    })
  }
}

/** The order settings (`order-settings` global) and the accepted terms version. */
export class PayloadOrderSettings extends PayloadRepository {
  async settings() {
    const data = await this.payload.findGlobal({ slug: 'order-settings', ...this.requestOptions })
    const open = await this.payload.find({
      collection: 'delivery-countries',
      where: { open: { equals: true } },
      pagination: false,
      depth: 0,
      ...this.requestOptions,
    })
    return {
      enabled: Boolean(data.enabled),
      countries: open.docs
        .map((doc) => doc.country)
        .sort((a, b) => countryName(a, 'fr').localeCompare(countryName(b, 'fr'), 'fr')),
      ownerEmail: data.ownerEmail || null,
    }
  }
  async termsVersion() {
    return (
      (await this.payload.findGlobal({ slug: 'legal-pages', depth: 0, ...this.requestOptions }))
        .terms.version || 'brouillon'
    )
  }
}
