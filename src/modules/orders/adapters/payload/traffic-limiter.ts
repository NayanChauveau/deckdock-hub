import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { TrafficLimiter } from '../../application/ports'
import { OrderError } from '../../domain/errors'
export class PostgresTrafficLimiter implements TrafficLimiter {
  constructor(private payload: Payload) {}
  async consume(identity: string, action: string, limit: number, now: Date) {
    const hour = Math.floor(now.getTime() / 3_600_000)
    for (const [keyPart, maximum] of [
      [identity, limit],
      ['global', action === 'checkout' ? 100 : 2000],
    ] as const) {
      const key = `${action}:${hour}:${keyPart}`
      const result = await this.payload.db.drizzle.execute(sql`
        INSERT INTO commerce_rate_limits (key, count, expires_at) VALUES (${key}, 1, ${new Date((hour + 2) * 3_600_000).toISOString()})
        ON CONFLICT (key) DO UPDATE SET count = commerce_rate_limits.count + 1 RETURNING count
      `)
      const count = Number(result.rows[0]?.['count'])
      if (!Number.isSafeInteger(count) || count > maximum) throw new OrderError('rate_limit')
    }
  }
}
