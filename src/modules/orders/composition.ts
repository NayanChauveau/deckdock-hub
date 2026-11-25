import { ordersSettings } from './settings'
/** Composition root of orders: the only place wiring its application ports to adapters. */
import { randomUUID } from 'node:crypto'
import type { Payload, PayloadRequest } from 'payload'
import { extensionsOf } from '@/core/modules/resolve'
import { mailSettings } from '@/core/email/smtp'
import { devOrigin, site } from '@/core/site'
import { createOrdersApplication, type OrdersApplication } from './application'
import type { OrderExtension } from './application/extension'
import { DisabledPaymentGateway, type PaymentGateway } from './application/ports'
import type { OrderDetails } from './domain/model'
import { SimulatedMailer, SmtpMailer } from './adapters/email/mailer'
import {
  orderExtensions,
  plainPersistence,
  type OrderPersistenceExtension,
} from './adapters/payload/persistence-extension'
import { PostgresTrafficLimiter } from './adapters/payload/traffic-limiter'
import { PayloadUnitOfWork } from './adapters/payload/unit-of-work'
import { HmacSigner, SignedOrderLinks } from './adapters/security/hmac'
import { isOrderReference } from './reference'

/** What the `orders` slot of this Payload config holds (see orders/module.ts). */
export function registeredOrderExtensions(payload: Payload) {
  return orderExtensions(
    extensionsOf(payload, 'orders', (value): value is unknown => value !== undefined),
  )
}

/** The payment gateway of the registered payment module, or none at all. */
export function configuredPayments(payload: Payload, origin: string): PaymentGateway {
  const { payments } = registeredOrderExtensions(payload)
  return payments ? payments.payments(process.env, origin) : new DisabledPaymentGateway()
}

/** Every port of the orders application except the extension, for orders or a selling module. */
export function orderPorts<D extends OrderDetails, X>(
  payload: Payload,
  request: PayloadRequest | undefined,
  persistence: OrderPersistenceExtension<D, X>,
) {
  const origin = process.env['APP_URL'] || devOrigin
  const signer = new HmacSigner(process.env['PAYLOAD_SECRET'] || '')
  const email = mailSettings(process.env)
  const brand = { name: site.identity.displayName, domain: site.identity.domain }
  return {
    uow: new PayloadUnitOfWork(payload, request, persistence),
    traffic: new PostgresTrafficLimiter(payload),
    clock: { now: () => new Date() },
    ids: {
      orderReference: () =>
        `${ordersSettings.referencePrefix}-${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`,
      isOrderReference,
    },
    signer,
    payments: configuredPayments(payload, origin),
    mailer: email.smtp
      ? new SmtpMailer(email.smtp, email.from, new URL(origin).hostname, brand, email.replyTo)
      : new SimulatedMailer(),
    links: new SignedOrderLinks(origin, signer),
    brand,
  }
}

/**
 * The extension's hooks only see orders of its kind: an order left by a removed module is
 * administered and mailed with the generic copy.
 */
function ownKindOnly<D extends OrderDetails, X>(
  extension: OrderExtension<D, X>,
): OrderExtension<D, X> {
  const own = (order: { kind: string }) => order.kind === extension.kind
  return {
    ...extension,
    canRetryPayment: (order) => !own(order) || (extension.canRetryPayment?.(order) ?? true),
    trackingView: (order) => (own(order) ? (extension.trackingView?.(order) ?? {}) : {}),
    emailRows: (order, locale) => (own(order) ? (extension.emailRows?.(order, locale) ?? []) : []),
    emailFor: (order, notice, links, brand) =>
      own(order) ? (extension.emailFor?.(order, notice, links, brand) ?? null) : null,
  }
}

/** The orders application of this site, with the registered extension and payment module. */
export function createOrders(payload: Payload, request?: PayloadRequest): OrdersApplication {
  const persistence = registeredOrderExtensions(payload).persistence ?? plainPersistence
  const ports = orderPorts(payload, request, persistence)
  return createOrdersApplication({
    ...ports,
    extension: ownKindOnly(persistence.application(ports)),
  })
}
