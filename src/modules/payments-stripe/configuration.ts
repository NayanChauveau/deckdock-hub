import {
  DisabledPaymentGateway,
  type PaymentGateway,
  type PaymentMode,
} from '../orders/application/ports'
import { SimulatedPaymentGateway } from './simulated-gateway'
import { StripeGateway } from './stripe-gateway'

export interface StripeEnvironment {
  COMMERCE_PAYMENT_MODE?: string | undefined
  NODE_ENV?: string | undefined
  STRIPE_MODE?: string | undefined
  STRIPE_TEST_SECRET_KEY?: string | undefined
  STRIPE_TEST_WEBHOOK_SECRET?: string | undefined
  STRIPE_LIVE_SECRET_KEY?: string | undefined
  STRIPE_LIVE_WEBHOOK_SECRET?: string | undefined
}
export function stripeConfiguration(environment: StripeEnvironment): {
  mode: 'test' | 'live'
  key: string
  webhookSecret: string
  enabled: boolean
} {
  const mode = environment.STRIPE_MODE || 'test'
  if (mode !== 'test' && mode !== 'live') throw new Error('STRIPE_MODE doit être test ou live.')
  const key =
    (mode === 'test' ? environment.STRIPE_TEST_SECRET_KEY : environment.STRIPE_LIVE_SECRET_KEY) ||
    ''
  const webhookSecret =
    (mode === 'test'
      ? environment.STRIPE_TEST_WEBHOOK_SECRET
      : environment.STRIPE_LIVE_WEBHOOK_SECRET) || ''
  if (!key && !webhookSecret && mode === 'test') return { mode, key, webhookSecret, enabled: false }
  if (!key.startsWith(`sk_${mode}_`) && !key.startsWith(`rk_${mode}_`))
    throw new Error(
      `STRIPE_${mode.toUpperCase()}_SECRET_KEY absente ou incompatible avec STRIPE_MODE.`,
    )
  if (!webhookSecret.startsWith('whsec_'))
    throw new Error(`STRIPE_${mode.toUpperCase()}_WEBHOOK_SECRET absent ou invalide.`)
  return { mode, key, webhookSecret, enabled: true }
}
export function configuredPaymentMode(environment: StripeEnvironment): PaymentMode {
  if (environment.COMMERCE_PAYMENT_MODE === 'simulated' && environment.NODE_ENV !== 'production')
    return 'simulation'
  const stripe = stripeConfiguration(environment)
  return stripe.enabled ? (stripe.mode === 'live' ? 'live' : 'sandbox') : 'disabled'
}

/** Simulated outside production when asked, Stripe when configured, otherwise no payment at all. */
export function paymentGateway(environment: StripeEnvironment, origin: string): PaymentGateway {
  const mode = configuredPaymentMode(environment)
  if (mode === 'simulation') return new SimulatedPaymentGateway()
  if (mode === 'disabled') return new DisabledPaymentGateway()
  const stripe = stripeConfiguration(environment)
  return new StripeGateway(stripe.key, stripe.webhookSecret, origin, stripe.mode)
}
