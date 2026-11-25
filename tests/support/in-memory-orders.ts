import { SimulatedMailer } from '../../src/modules/orders/adapters/email/mailer'
import type {
  Notification,
  OrderDetails,
  OrderSnapshot,
} from '../../src/modules/orders/domain/model'
import { Order } from '../../src/modules/orders/domain/order'
import { createOrdersApplication } from '../../src/modules/orders/application'
import { plainOrders, type OrderExtension } from '../../src/modules/orders/application/extension'
import type {
  Clock,
  Mailer,
  OrderSettings,
  PaymentGateway,
  PaymentSession,
  Signer,
  Transaction,
  UnitOfWork,
} from '../../src/modules/orders/application/ports'

export class FixedClock implements Clock {
  constructor(public instant = '2026-10-26T09:00:00.000Z') {}
  now() {
    return new Date(this.instant)
  }
  advance(milliseconds: number) {
    this.instant = new Date(this.now().getTime() + milliseconds).toISOString()
  }
}

/** Orders kept in memory, with transactions that roll back on error and run one at a time. */
export class MemoryOrders<D extends OrderDetails = OrderDetails, X = object> implements UnitOfWork<
  D,
  X
> {
  orders = new Map<number, OrderSnapshot<D>>()
  paymentEvents = new Set<string>()
  notifications: Notification[] = []
  settings: OrderSettings = { enabled: true, countries: ['FR', 'BE'], ownerEmail: null }
  sequence = 0
  private tail = Promise.resolve()

  constructor(private extra: X) {}

  private scope(): Transaction<D, X> {
    const restore = (state: OrderSnapshot<D> | undefined) => (state ? Order.restore(state) : null)
    const find = (predicate: (order: OrderSnapshot<D>) => boolean) =>
      restore([...this.orders.values()].find(predicate))
    const list = (predicate: (order: OrderSnapshot<D>) => boolean, limit: number) =>
      [...this.orders.values()]
        .filter(predicate)
        .slice(0, limit)
        .map((state) => Order.restore(state))
    return {
      ...this.extra,
      orders: {
        findById: async (id) => restore(this.orders.get(id)),
        findByReference: async (reference) => find((order) => order.reference === reference),
        findByAttempt: async (id) => find((order) => order.attemptId === id),
        findByPayment: async (id) => find((order) => order.paymentId === id),
        create: async (order) => {
          const state = order.snapshot
          state.id = ++this.sequence
          this.orders.set(state.id, state)
          return Order.restore(state)
        },
        save: async (order) => {
          this.orders.set(order.snapshot.id, order.snapshot)
        },
        unconfirmedPayments: async (limit) =>
          list(
            (order) =>
              ['pending', 'expired', 'failed'].includes(order.paymentStatus) &&
              order.paymentSessionId !== null,
            limit,
          ),
        expiredPayments: async (now, limit) =>
          list((order) => order.paymentStatus === 'pending' && order.paymentExpiresAt < now, limit),
      },
      paymentEvents: {
        has: async (id) => this.paymentEvents.has(id),
        record: async (event) => {
          this.paymentEvents.add(event.eventId)
        },
      },
      notifications: {
        enqueue: async (orderId, key, kind, now) => {
          if (this.notifications.some((notice) => notice.key === key)) return
          this.notifications.push({
            id: ++this.sequence,
            key,
            orderId,
            kind,
            status: 'pending',
            attempts: 0,
            nextAttemptAt: now,
            sentAt: null,
            lastError: null,
            subject: null,
            body: null,
          })
        },
        ready: async (now, limit) =>
          structuredClone(
            this.notifications
              .filter(
                (notice) =>
                  ['pending', 'failed'].includes(notice.status) && notice.nextAttemptAt <= now,
              )
              .slice(0, limit),
          ),
        find: async (id) =>
          structuredClone(this.notifications.find((notice) => notice.id === id) ?? null),
        save: async (notice) => {
          const index = this.notifications.findIndex((item) => item.id === notice.id)
          this.notifications[index] = structuredClone(notice)
        },
      },
      rateLimits: {
        removeExpired: async () => {
          /* No persistent rate-limit records in this adapter. */
        },
      },
      settings: async () => structuredClone(this.settings),
      termsVersion: async () => 'test-terms',
    }
  }

  async read<T>(work: (tx: Transaction<D, X>) => Promise<T>) {
    return work(this.scope())
  }

  async run<T>(work: (tx: Transaction<D, X>) => Promise<T>): Promise<T> {
    const previous = this.tail
    let unlock!: () => void
    this.tail = new Promise<void>((resolve) => {
      unlock = resolve
    })
    await previous
    const before = structuredClone({
      orders: this.orders,
      paymentEvents: this.paymentEvents,
      notifications: this.notifications,
      sequence: this.sequence,
    })
    try {
      return await work(this.scope())
    } catch (error) {
      Object.assign(this, before)
      throw error
    } finally {
      unlock()
    }
  }
}

/** The orders application on memory adapters, in local simulation mode unless told otherwise. */
export function memoryOrders<D extends OrderDetails = OrderDetails, X = object>(
  options: {
    extension?: OrderExtension<D, X>
    extra?: X
    payments?: PaymentGateway
    mailer?: Mailer
  } = {},
) {
  const store = new MemoryOrders<D, X>(options.extra ?? ({} as X))
  const clock = new FixedClock()
  let reference = 0
  const signer: Signer = {
    sign: (value) => `signed:${value}`,
    orderToken: (value) => `token:${value}`,
    verifyOrderToken: (value, token) => token === `token:${value}`,
  }
  const gateway: PaymentGateway = {
    mode: () => 'simulation',
    createSession: async (order): Promise<PaymentSession> => ({
      id: 'fake',
      reference: order.reference,
      amount: order.totalCents,
      currency: 'EUR',
      paid: false,
      expired: false,
      open: true,
      url: `/${order.locale}/commande/suivi/${order.reference}`,
    }),
    readSession: async () => {
      throw new Error('Unavailable')
    },
    verifyNotification: async () => null,
  }
  const app = createOrdersApplication<D, X>({
    uow: store,
    clock,
    signer,
    payments: options.payments ?? gateway,
    ids: {
      orderReference: () => `TS-${(++reference).toString(16).padStart(16, '0').toUpperCase()}`,
      isOrderReference: (value) => /^TS-[A-F0-9]{16}$/.test(value),
    },
    mailer: options.mailer ?? new SimulatedMailer(),
    brand: { name: 'Atelier test', domain: 'shop.example.test' },
    links: {
      tracking: (order) => `https://test.invalid/${order.reference}`,
      admin: (order) => `https://test.invalid/admin/${order.id}`,
      home: (order) => `https://test.invalid/${order.locale}`,
      terms: (order) => `https://test.invalid/${order.locale}/cgv`,
    },
    traffic: {
      consume: async () => {
        /* Rate limiting is covered by the PostgreSQL adapter. */
      },
    },
    extension: options.extension ?? (plainOrders as OrderExtension<D, X>),
  })
  return { app, store, clock, signer, gateway }
}
