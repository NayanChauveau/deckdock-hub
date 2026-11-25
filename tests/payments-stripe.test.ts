import assert from 'node:assert/strict'
import { test } from 'node:test'
import Stripe from 'stripe'
import { DisabledPaymentGateway } from '../src/modules/orders/application/ports'
import { OrderError } from '../src/modules/orders/domain/errors'
import type { OrderSnapshot } from '../src/modules/orders/domain/model'
import { checkoutReturn, trackingPath } from '../src/modules/orders/paths'
import {
  configuredPaymentMode,
  paymentGateway,
  stripeConfiguration,
} from '../src/modules/payments-stripe/configuration'
import { SimulatedPaymentGateway } from '../src/modules/payments-stripe/simulated-gateway'
import { lineItems, StripeGateway } from '../src/modules/payments-stripe/stripe-gateway'

const order: OrderSnapshot = {
  id: 1,
  reference: 'EX-0123456789ABCDEF',
  attemptId: '00000000-0000-4000-8000-000000000001',
  locale: 'fr',
  kind: 'plain',
  customer: {
    name: 'Test',
    email: 'test@example.test',
    address: '1 Test',
    address2: '',
    postalCode: '75001',
    city: 'Paris',
    country: 'FR',
  },
  lines: [{ label: 'Pièce', unitCents: 2000, quantity: 1 }],
  itemsCents: 2000,
  shippingCents: 400,
  totalCents: 2400,
  currency: 'EUR',
  paymentStatus: 'pending',
  fulfillmentStatus: 'awaiting_payment',
  paymentSessionId: null,
  paymentId: null,
  paymentExpiresAt: '2026-11-20T10:31:00.000Z',
  paidAt: null,
  shippedAt: null,
  trackingNumber: null,
  customerComment: '',
  internalNote: null,
  termsVersion: 'v1',
  termsAcceptedAt: '2026-11-20T10:00:00.000Z',
  history: [],
  details: {},
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T10:00:00.000Z',
}
const keys = {
  STRIPE_TEST_SECRET_KEY: 'sk_test_fake',
  STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test',
  STRIPE_LIVE_SECRET_KEY: 'sk_live_fake',
  STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live',
}

void test('Stripe credentials are selected as one pair with no fallback between modes', () => {
  assert.deepEqual(stripeConfiguration(keys), {
    mode: 'test',
    key: 'sk_test_fake',
    webhookSecret: 'whsec_test',
    enabled: true,
  })
  assert.deepEqual(stripeConfiguration({ ...keys, STRIPE_MODE: 'live' }), {
    mode: 'live',
    key: 'sk_live_fake',
    webhookSecret: 'whsec_live',
    enabled: true,
  })
  assert.throws(() =>
    stripeConfiguration({ ...keys, STRIPE_MODE: 'live', STRIPE_LIVE_WEBHOOK_SECRET: '' }),
  )
  assert.throws(() =>
    stripeConfiguration({ ...keys, STRIPE_MODE: 'live', STRIPE_LIVE_SECRET_KEY: 'sk_test_fake' }),
  )
  assert.throws(
    () => new StripeGateway('sk_live_fake', 'whsec_test', 'https://example.test', 'test'),
  )
  assert.throws(
    () => new StripeGateway('sk_test_fake', 'whsec_live', 'https://example.test', 'live'),
  )
})

for (const mode of ['test', 'live'] as const)
  void test(`Stripe ${mode}: authenticates own webhooks and refuses the other mode before processing`, async () => {
    const secret = `whsec_${mode}`
    const gateway = new StripeGateway(`sk_${mode}_fake`, secret, 'https://example.test', mode)
    const stripe = new Stripe(`sk_${mode}_fake`)
    const event = {
      id: 'evt_fake',
      type: 'charge.refunded',
      livemode: mode === 'live',
      data: {
        object: { payment_intent: 'pi_fake', amount: 1000, amount_refunded: 1000, currency: 'eur' },
      },
    }
    const body = JSON.stringify(event)
    const sign = (payload: string, signingSecret = secret) =>
      stripe.webhooks.generateTestHeaderString({ payload, secret: signingSecret })
    const update = await gateway.verifyNotification(new TextEncoder().encode(body), sign(body))
    assert.equal(update?.state, 'refunded')
    assert.equal(update.paymentId, 'pi_fake')
    const other = JSON.stringify({ ...event, livemode: !event.livemode })
    await assert.rejects(
      gateway.verifyNotification(new TextEncoder().encode(other), sign(other)),
      (error: unknown) => error instanceof OrderError && error.code === 'payment_mode_mismatch',
    )
    await assert.rejects(
      gateway.verifyNotification(new TextEncoder().encode(body), sign(body, 'whsec_wrong')),
      (error: unknown) => error instanceof OrderError && error.code === 'signature',
    )
    assert.equal(gateway.mode(), mode === 'live' ? 'live' : 'sandbox')
  })

void test('Stripe signature rejects tampering', () => {
  const stripe = new Stripe('sk_test_dummy')
  const payload = JSON.stringify({
    id: 'evt_test',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: {} },
  })
  const secret = 'whsec_test'
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret })
  assert.equal(stripe.webhooks.constructEvent(payload, header, secret).id, 'evt_test')
  assert.throws(() => stripe.webhooks.constructEvent(payload + ' ', header, secret))
})

void test('local simulation is impossible in production; live requires explicit selection', () => {
  assert.equal(
    configuredPaymentMode({ NODE_ENV: 'development', COMMERCE_PAYMENT_MODE: 'simulated' }),
    'simulation',
  )
  assert.equal(
    configuredPaymentMode({ NODE_ENV: 'production', COMMERCE_PAYMENT_MODE: 'simulated' }),
    'disabled',
  )
  assert.equal(configuredPaymentMode(keys), 'sandbox')
  assert.equal(configuredPaymentMode({ ...keys, STRIPE_MODE: 'live' }), 'live')
  assert.equal(
    configuredPaymentMode({
      STRIPE_LIVE_SECRET_KEY: 'sk_live_dummy',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live',
    }),
    'disabled',
  )
  assert.throws(() => configuredPaymentMode({ ...keys, STRIPE_MODE: 'invalid' }))
  assert.throws(() => configuredPaymentMode({ ...keys, STRIPE_TEST_SECRET_KEY: 'sk_live_dummy' }))
  assert.throws(() => configuredPaymentMode({ STRIPE_MODE: 'live' }))
  assert.throws(() => configuredPaymentMode({ STRIPE_TEST_SECRET_KEY: 'sk_test_dummy' }))
})

void test('the gateway follows the configured mode', () => {
  const origin = 'https://example.test'
  assert.ok(
    paymentGateway(
      { NODE_ENV: 'development', COMMERCE_PAYMENT_MODE: 'simulated' },
      origin,
    ) instanceof SimulatedPaymentGateway,
  )
  assert.ok(paymentGateway({ NODE_ENV: 'production' }, origin) instanceof DisabledPaymentGateway)
  assert.ok(paymentGateway({ NODE_ENV: 'production', ...keys }, origin) instanceof StripeGateway)
})

void test('the simulated payment returns to the tracking page of the site', async () => {
  const session = await new SimulatedPaymentGateway().createSession(order)
  assert.equal(session.url, trackingPath('fr', order.reference))
  assert.equal(trackingPath('en', 'EX-0123456789ABCDEF'), '/en/commande/suivi/EX-0123456789ABCDEF')
})

void test('the payment page returns to the tracking page, marked paid or cancelled', () => {
  assert.deepEqual(checkoutReturn('fr', 'EX-0123456789ABCDEF'), {
    success: '/fr/commande/suivi/EX-0123456789ABCDEF?paid=1',
    cancel: '/fr/commande/suivi/EX-0123456789ABCDEF?cancelled=1',
  })
})

void test('checkout line items come from the order lines, shipping last', () => {
  assert.deepEqual(
    lineItems({
      ...order,
      lines: [{ label: 'Tirage A4', unitCents: 4500, quantity: 2 }],
      shippingCents: 600,
    }).map((item) => [
      item.price_data.product_data.name,
      item.price_data.unit_amount,
      item.quantity,
    ]),
    [
      ['Tirage A4', 4500, 2],
      ['Livraison', 600, 1],
    ],
  )
  assert.deepEqual(
    lineItems({ ...order, locale: 'en', shippingCents: 0 }).map(
      (item) => item.price_data.product_data.name,
    ),
    ['Pièce'],
  )
})
