import { OrderError } from '../domain/errors'
import type { Clock, Identifiers, Signer, TrafficLimiter } from './ports'

/** The private tracking link: a reference of this site and its signed token, or nothing at all. */
export class AccessOrder {
  constructor(
    private signer: Signer,
    private ids: Identifiers,
  ) {}
  issue(reference: string) {
    if (!this.ids.isOrderReference(reference)) throw new OrderError('reference')
    return this.signer.orderToken(reference)
  }
  authorize(reference: string, token: string | null | undefined) {
    if (!this.ids.isOrderReference(reference) || !this.signer.verifyOrderToken(reference, token))
      throw new OrderError('not_found')
  }
}

export class CheckTraffic {
  constructor(
    private limiter: TrafficLimiter,
    private signer: Signer,
    private clock: Clock,
  ) {}
  execute(identity: string, action: string, maximum: number) {
    return this.limiter.consume(this.signer.sign(identity), action, maximum, this.clock.now())
  }
}
