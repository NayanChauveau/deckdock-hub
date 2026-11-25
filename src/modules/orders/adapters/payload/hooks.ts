import { isDeepStrictEqual } from 'node:util'
import type { Order } from '@/payload-types'
import { APIError, ValidationError } from 'payload'
import type { CollectionAfterChangeHook, CollectionBeforeChangeHook } from 'payload'
import { createOrders } from '../../composition'
import { OrderError } from '../../domain/errors'
import type { OrderEvent } from '../../domain/model'
import { orderToDoc } from './mapper'
import type { OrderPersistenceExtension } from './persistence-extension'

type BeforeChangeArgs = Parameters<CollectionBeforeChangeHook<Order>>[0]

const fieldOfError: Record<string, string> = {
  payment_required: 'fulfillmentStatus',
  transition: 'fulfillmentStatus',
  tracking: 'trackingNumber',
}

/**
 * A business refusal of the domain becomes Payload's public error, so the administration shows its
 * French message (on the field when there is one) instead of « Something went wrong ». Anything
 * else stays an unexpected error (500).
 */
function publicError(error: unknown, req: Parameters<CollectionBeforeChangeHook>[0]['req']) {
  if (!(error instanceof OrderError)) return error
  const path = fieldOfError[error.code]
  if (path)
    return new ValidationError({
      collection: 'orders',
      errors: [{ message: error.message, path }],
      req,
    })
  return new APIError(error.message, error.code === 'not_found' ? 404 : 400, undefined, true)
}

/** Native admin saves go through the aggregate; only these fields are editable. */
export function orderHooks(persistence: OrderPersistenceExtension) {
  const beforeChange: CollectionBeforeChangeHook<Order> = async ({
    data,
    originalDoc,
    req,
    operation,
    context,
  }) => {
    if (context['ordersPersistence'] || req.context['ordersPersistence']) return data
    try {
      return await adminChange({ data, originalDoc, req, operation } as BeforeChangeArgs)
    } catch (error) {
      throw publicError(error, req)
    }
  }
  const adminChange = async ({ data, originalDoc, req, operation }: BeforeChangeArgs) => {
    if (operation === 'create')
      throw new OrderError('order_creation', 'Utiliser le parcours de commande.')
    if (!originalDoc) throw new OrderError('not_found')
    // Compare readonly values structurally because the CMS can reorder object keys on submit.
    const originalValues: Record<string, unknown> = { ...originalDoc }
    const editable = new Set(['fulfillmentStatus', 'trackingNumber', 'internalNote', 'updatedAt'])
    for (const [key, value] of Object.entries(data)) {
      if (!editable.has(key) && !isDeepStrictEqual(value, originalValues[key]))
        throw new OrderError(
          'immutable_order',
          'Les données de paiement et de commande sont immuables.',
        )
    }
    const result = await createOrders(req.payload, req).admin.prepare(
      originalDoc.id,
      {
        ...(data.fulfillmentStatus !== undefined &&
        data.fulfillmentStatus !== originalDoc.fulfillmentStatus
          ? { fulfillmentStatus: data.fulfillmentStatus }
          : {}),
        ...(data.trackingNumber !== undefined && data.trackingNumber !== originalDoc.trackingNumber
          ? { trackingNumber: data.trackingNumber }
          : {}),
        ...(data.internalNote !== undefined && data.internalNote !== originalDoc.internalNote
          ? { internalNote: data.internalNote }
          : {}),
      },
      req.user?.id ?? 'system',
    )
    req.context['orderEvents'] = result.events
    // Persist the fresh aggregate, never stale readonly values from a CMS form.
    return { ...data, ...orderToDoc(result.snapshot, persistence) }
  }
  const afterChange: CollectionAfterChangeHook<Order> = async ({ doc, req, context }) => {
    if (context['ordersPersistence'] || req.context['ordersPersistence']) return doc
    const events = (req.context['orderEvents'] || []) as OrderEvent[]
    delete req.context['orderEvents']
    await createOrders(req.payload, req).admin.complete(events)
    return doc
  }
  return { beforeChange, afterChange }
}
