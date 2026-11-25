import type { Order } from '@/payload-types'
import type { HistoryEntry, OrderDetails, OrderLine, OrderSnapshot } from '../../domain/model'
import { Order as DomainOrder } from '../../domain/order'
import { customerValue, euroCurrency } from '../../domain/value-objects'
import type { OrderPersistenceExtension } from './persistence-extension'

function amount(value: number | null | undefined): number {
  if (typeof value !== 'number') throw new TypeError('Montant persistant absent.')
  return value
}
function history(value: unknown): HistoryEntry[] {
  if (!Array.isArray(value)) return []
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || !('at' in entry) || typeof entry.at !== 'string')
      throw new TypeError('Historique persistant invalide.')
    // Historical audit details remain data; domain transitions validate current statuses.
    return structuredClone(entry) as HistoryEntry
  })
}
function lines(value: unknown): OrderLine[] {
  if (!Array.isArray(value)) throw new TypeError('Lignes de commande persistantes absentes.')
  return value.map((line: unknown) => {
    if (
      !line ||
      typeof line !== 'object' ||
      !('label' in line) ||
      !('unitCents' in line) ||
      !('quantity' in line) ||
      typeof line.label !== 'string' ||
      typeof line.unitCents !== 'number' ||
      typeof line.quantity !== 'number'
    )
      throw new TypeError('Ligne de commande persistante invalide.')
    return { label: line.label, unitCents: line.unitCents, quantity: line.quantity }
  })
}

/**
 * A row of `orders` as an aggregate. The extension reads its own columns; a row of another kind
 * (its module was removed) keeps empty details and can still be paid, administered and tracked.
 */
export function orderFromDoc<D extends OrderDetails, X>(
  doc: Order,
  extension: OrderPersistenceExtension<D, X>,
): DomainOrder<D> {
  if (typeof doc.attemptId !== 'string')
    throw new TypeError('Identifiant de tentative persistant absent.')
  if (!doc.paymentExpiresAt) throw new TypeError('Expiration persistante absente.')
  const row: Record<string, unknown> = { ...doc }
  return DomainOrder.restore<D>({
    id: doc.id,
    reference: doc.reference,
    attemptId: doc.attemptId,
    locale: doc.locale,
    kind: doc.kind,
    customer: customerValue({ ...doc.customer, address2: doc.customer.address2 || '' }),
    lines: lines(doc.lines),
    itemsCents: amount(doc.itemsCents),
    shippingCents: amount(doc.shippingCents),
    totalCents: amount(doc.totalCents),
    currency: euroCurrency(doc.currency),
    paymentStatus: doc.paymentStatus,
    fulfillmentStatus: doc.fulfillmentStatus,
    paymentSessionId: doc.paymentSessionId || null,
    paymentId: doc.paymentId || null,
    paymentExpiresAt: doc.paymentExpiresAt,
    paidAt: doc.paidAt || null,
    shippedAt: doc.shippedAt || null,
    trackingNumber: doc.trackingNumber ?? null,
    customerComment: doc.customerComment ?? '',
    internalNote: doc.internalNote ?? null,
    termsVersion: doc.termsVersion || null,
    termsAcceptedAt: doc.termsAcceptedAt || null,
    history: history(doc.history),
    // Only the extension that owns the kind can read its columns.
    details: doc.kind === extension.kind ? extension.detailsFromDoc(row) : ({} as D),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  })
}

/** The columns of one order; the extension's columns only for an order of its kind. */
export function orderToDoc<D extends OrderDetails, X>(
  state: OrderSnapshot<D>,
  extension: OrderPersistenceExtension<D, X>,
): Record<string, unknown> {
  return {
    reference: state.reference,
    attemptId: state.attemptId,
    locale: state.locale,
    kind: state.kind,
    customer: { ...state.customer },
    lines: state.lines.map((line) => ({ ...line })),
    itemsCents: state.itemsCents,
    shippingCents: state.shippingCents,
    totalCents: state.totalCents,
    currency: state.currency,
    paymentStatus: state.paymentStatus,
    fulfillmentStatus: state.fulfillmentStatus,
    paymentSessionId: state.paymentSessionId,
    paymentId: state.paymentId,
    paymentExpiresAt: state.paymentExpiresAt,
    paidAt: state.paidAt,
    shippedAt: state.shippedAt,
    trackingNumber: state.trackingNumber,
    customerComment: state.customerComment,
    internalNote: state.internalNote,
    history: state.history,
    termsVersion: state.termsVersion,
    termsAcceptedAt: state.termsAcceptedAt,
    ...(state.kind === extension.kind ? extension.detailsToDoc(state.details) : {}),
  }
}
