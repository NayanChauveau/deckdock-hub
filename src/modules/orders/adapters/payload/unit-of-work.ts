import { sql, type PostgresAdapter } from '@payloadcms/db-postgres'
import { createLocalReq, type Payload, type PayloadRequest } from 'payload'
import type { Transaction, UnitOfWork } from '../../application/ports'
import type { OrderDetails } from '../../domain/model'
import type { OrderPersistenceExtension } from './persistence-extension'
import {
  PayloadNotifications,
  PayloadOrders,
  PayloadOrderSettings,
  PayloadPaymentEvents,
  PayloadRateLimits,
} from './repositories'

/** Every order write is serialised by one transaction-scoped advisory lock (key kept as is). */
export async function lockOrders(req: PayloadRequest) {
  const id = await req.transactionID
  if (!id) throw new Error('Transaction PostgreSQL requise.')
  const session = (req.payload.db as unknown as PostgresAdapter).sessions[String(id)]
  if (!session) throw new Error('Transaction absente.')
  await session.db.execute(sql`SELECT pg_advisory_xact_lock(761922005)`)
}

export class PayloadUnitOfWork<D extends OrderDetails, X> implements UnitOfWork<D, X> {
  constructor(
    private payload: Payload,
    private existingRequest: PayloadRequest | undefined,
    private extension: OrderPersistenceExtension<D, X>,
  ) {}
  private repositories(req?: PayloadRequest): Transaction<D, X> {
    const settings = new PayloadOrderSettings(this.payload, req)
    const extra = this.extension.repositories?.(this.payload, req) ?? ({} as X)
    return {
      ...extra,
      orders: new PayloadOrders(this.payload, req, this.extension),
      paymentEvents: new PayloadPaymentEvents(this.payload, req),
      notifications: new PayloadNotifications(this.payload, req),
      rateLimits: new PayloadRateLimits(this.payload, req),
      settings: () => settings.settings(),
      termsVersion: () => settings.termsVersion(),
    }
  }
  async read<T>(work: (tx: Transaction<D, X>) => Promise<T>) {
    return work(this.repositories(this.existingRequest))
  }
  async run<T>(work: (tx: Transaction<D, X>) => Promise<T>): Promise<T> {
    if (this.existingRequest) {
      // Payload owns this transaction (native admin hooks); never nest or commit it.
      await lockOrders(this.existingRequest)
      return work(this.repositories(this.existingRequest))
    }
    const id = await this.payload.db.beginTransaction()
    if (!id) throw new Error('Transaction PostgreSQL indisponible.')
    const req = await createLocalReq({ req: { transactionID: id } }, this.payload)
    try {
      await lockOrders(req)
      const result = await work(this.repositories(req))
      await this.payload.db.commitTransaction(id)
      return result
    } catch (error) {
      await this.payload.db.rollbackTransaction(id)
      throw error
    }
  }
}
