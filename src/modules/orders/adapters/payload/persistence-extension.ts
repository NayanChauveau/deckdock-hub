import type { Field, Payload, PayloadRequest } from 'payload'
import { plainOrders, type OrderExtension } from '../../application/extension'
import type { Clock, PaymentGateway, UnitOfWork } from '../../application/ports'
import type { OrderDetails } from '../../domain/model'

/** What an extension (the module that sells something) adds to the Orders collection. */
export interface OrderPersistenceExtension<D extends OrderDetails = OrderDetails, X = object> {
  kind: string
  /** Rendered after `internalNote`; real columns of `orders`. */
  fields: Field[]
  defaultColumns?: string[]
  /** Appended to the fields of `delivery-countries` (for example a rate per country). */
  countryFields?: Field[]
  /** Added to the outbox `kind` options. */
  noticeKinds?: { label: string; value: string }[]
  detailsFromDoc(doc: Record<string, unknown>): D
  detailsToDoc(details: D): Record<string, unknown>
  repositories?(payload: Payload, req: PayloadRequest | undefined): X
  /** Built per request, once the unit of work and the gateway exist. */
  application(ports: {
    clock: Clock
    uow: UnitOfWork<D, X>
    payments: PaymentGateway
  }): OrderExtension<D, X>
}

/** What a payment module adds: the gateway for this environment. */
export interface OrderPaymentsExtension {
  payments(environment: NodeJS.ProcessEnv, origin: string): PaymentGateway
}

/** Orders that need nothing beyond lines and a price (no extension registered). */
export const plainPersistence: OrderPersistenceExtension = {
  kind: plainOrders.kind,
  fields: [],
  detailsFromDoc: () => ({}),
  detailsToDoc: () => ({}),
  application: () => plainOrders,
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * The `orders` extension slot holds two shapes: a persistence extension (a `kind` key) and a
 * payment module (a `payments` key). At most one of each.
 */
export function orderExtensions(values: readonly unknown[]): {
  persistence: OrderPersistenceExtension | undefined
  payments: OrderPaymentsExtension | undefined
} {
  const persistence = values.filter(
    (value): value is OrderPersistenceExtension => isObject(value) && 'kind' in value,
  )
  const payments = values.filter(
    (value): value is OrderPaymentsExtension => isObject(value) && 'payments' in value,
  )
  if (persistence.length > 1)
    throw new Error('Module orders : une seule extension de commande (kind) est possible.')
  if (payments.length > 1)
    throw new Error('Module orders : un seul module de paiement (payments) est possible.')
  if (persistence.length + payments.length !== values.length)
    throw new Error('Module orders : extension inconnue (ni kind ni payments).')
  return { persistence: persistence[0], payments: payments[0] }
}
