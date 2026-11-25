import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Order } from '../src/modules/orders/domain/order'
import { OrderError } from '../src/modules/orders/domain/errors'
import type { OrderSnapshot, PaymentUpdate } from '../src/modules/orders/domain/model'
import { EuroAmount, countryValue, customerValue } from '../src/modules/orders/domain/value-objects'
import { COUNTRY_CODES, EU_COUNTRIES, countryName, isEuCountry } from '../src/core/domain/countries'

const now = '2026-11-20T10:00:00.000Z'
const customer = customerValue({
  name: 'Test',
  email: 'test@example.test',
  address: '1 Test',
  address2: '',
  postalCode: '75001',
  city: 'Paris',
  country: 'FR',
})
const placed: OrderSnapshot = {
  id: 0,
  reference: 'AB-0123456789ABCDEF',
  attemptId: '00000000-0000-4000-8000-000000000001',
  locale: 'fr',
  kind: 'test-item',
  customer,
  lines: [{ label: 'Pièce', unitCents: 2000, quantity: 1 }],
  itemsCents: 2000,
  shippingCents: 400,
  totalCents: 2400,
  currency: 'EUR',
  paymentStatus: 'pending',
  fulfillmentStatus: 'awaiting_payment',
  paymentSessionId: 'session-1',
  paymentId: null,
  paymentExpiresAt: '2026-11-20T10:31:00.000Z',
  paidAt: null,
  shippedAt: null,
  trackingNumber: null,
  customerComment: '',
  internalNote: null,
  termsVersion: 'v1',
  termsAcceptedAt: now,
  history: [],
  details: {},
  createdAt: now,
  updatedAt: now,
}
const paid: OrderSnapshot = {
  ...placed,
  id: 7,
  paymentStatus: 'paid',
  fulfillmentStatus: 'queued',
  paidAt: now,
}
const pay = (eventId: string): PaymentUpdate => ({
  eventId,
  eventType: 'test.paid',
  reference: placed.reference,
  amount: 2400,
  currency: 'eur',
  state: 'paid',
})

void test('euro value objects reject invalid units and totals', () => {
  assert.equal(EuroAmount.of(2000).plus(EuroAmount.of(400)).cents, 2400)
  for (const value of [-1, 0.5, NaN, Infinity, 100_000_000])
    assert.throws(() => EuroAmount.of(value), OrderError)
  assert.throws(() => Order.restore({ ...paid, totalCents: 1 }), OrderError)
})

void test('amounts are the sum of the lines plus shipping', () => {
  assert.throws(
    () =>
      Order.restore({
        ...paid,
        lines: [{ label: 'x', unitCents: 4500, quantity: 2 }],
        itemsCents: 4500,
        shippingCents: 600,
        totalCents: 5100,
      }),
    /prices_unavailable/,
  )
  assert.equal(
    Order.restore({
      ...paid,
      lines: [{ label: 'x', unitCents: 4500, quantity: 2 }],
      itemsCents: 9000,
      shippingCents: 600,
      totalCents: 9600,
    }).snapshot.totalCents,
    9600,
  )
  for (const lines of [
    [{ label: 'x', unitCents: 2000, quantity: 0 }],
    [{ label: 'x', unitCents: 20.5, quantity: 1 }],
  ])
    assert.throws(() => Order.restore({ ...paid, lines }), OrderError)
})

void test('placing an order records the terms and starts unpaid', () => {
  const order = Order.place(placed)
  assert.deepEqual(order.snapshot.history, [{ at: now, action: 'created' }])
  assert.throws(() => Order.place({ ...placed, termsVersion: null }), /terms/)
  assert.throws(() => Order.place({ ...placed, paymentStatus: 'paid' }), /order_state/)
})

void test('the aggregate prevents unpaid fulfilment and protects its state from outside changes', () => {
  const order = Order.place(placed)
  assert.throws(() => {
    order.changeFulfillment('in_progress', now)
  }, OrderError)
  const copy = order.snapshot
  copy.totalCents = 1
  copy.customer = { ...copy.customer, name: 'Mutated' }
  assert.equal(order.snapshot.totalCents, 2400)
  assert.equal(order.snapshot.customer.name, 'Test')
})

void test('payment, fulfilment and refund transitions emit events without regression', () => {
  const order = Order.place(placed)
  order.receivePayment(pay('paid-1'), now)
  assert.equal(order.snapshot.fulfillmentStatus, 'queued')
  assert.ok(order.releaseEvents().some((event) => event.type === 'OrderPaymentConfirmed'))
  order.receivePayment(pay('paid-2'), now)
  assert.deepEqual(order.releaseEvents(), [])
  order.receivePayment({ ...pay('expired'), state: 'expired' }, now)
  assert.equal(order.snapshot.paymentStatus, 'paid')
  order.receivePayment({ ...pay('refund'), state: 'refunded' }, now)
  assert.equal(order.snapshot.fulfillmentStatus, 'cancelled')
  order.receivePayment(pay('late-paid'), now)
  assert.equal(order.snapshot.paymentStatus, 'refunded')
})

void test('a payment received after cancellation asks for a manual refund', () => {
  const order = Order.place(placed)
  order.changeFulfillment('cancelled', now)
  order.receivePayment(pay('paid-late'), now)
  assert.equal(
    order.snapshot.internalNote,
    'Paiement reçu après annulation : remboursement manuel nécessaire dans le service de paiement.',
  )
})

void test('extension details change only through amendDetails, which can emit a notice event', () => {
  const order = Order.restore({ ...paid, details: { size: 'a4' } })
  assert.equal(order.amendDetails({ size: 'a4' }, now), false)
  assert.equal(
    order.amendDetails({ size: 'a3' }, now, { notice: 'schedule_changed', key: 'k' }),
    true,
  )
  const events = order.releaseEvents()
  assert.deepEqual(
    events.map((event) => event.type),
    ['OrderExtensionEvent'],
  )
  const copy = order.snapshot
  ;(copy.details as Record<string, unknown>)['size'] = 'mutated'
  assert.equal(order.snapshot.details.size, 'a3')
})

void test('an order of an unknown kind restores and can be administered', () => {
  const order = Order.restore({ ...paid, kind: 'removed-module', details: {} })
  order.amendAdministration({ internalNote: 'ok' }, now, 1)
  assert.equal(order.snapshot.internalNote, 'ok')
})

void test('an administrator cannot change the fulfilment of an order that is not paid', () => {
  for (const paymentStatus of ['pending', 'failed', 'expired'] as const) {
    const order = Order.restore({ ...placed, paymentStatus })
    for (const next of ['queued', 'cancelled'] as const)
      assert.throws(
        () => {
          order.amendAdministration({ fulfillmentStatus: next }, now, 1)
        },
        {
          code: 'payment_required',
          message: 'Le paiement doit être confirmé (Payé) avant de changer la réalisation.',
        },
      )
    assert.equal(order.snapshot.fulfillmentStatus, 'awaiting_payment')
  }
  const paidOrder = Order.restore(paid)
  paidOrder.amendAdministration({ fulfillmentStatus: 'in_progress' }, now, 1)
  assert.equal(paidOrder.snapshot.fulfillmentStatus, 'in_progress')
  // The system keeps managing the status of an unpaid order (expiry, payment confirmation).
  const unpaid = Order.restore(placed)
  unpaid.changeFulfillment('cancelled', now)
  assert.equal(unpaid.snapshot.fulfillmentStatus, 'cancelled')
  // A note or tracking number stays editable on an unpaid order.
  Order.restore(placed).amendAdministration({ internalNote: 'ok', trackingNumber: 'X' }, now, 1)
})

void test('a retried checkout must be the same attempt, still payable', () => {
  const order = Order.place(placed)
  order.sameAttempt(customer, '', '2026-11-20T10:05:00.000Z')
  assert.throws(() => {
    order.sameAttempt({ ...customer, name: 'Other' }, '', '2026-11-20T10:05:00.000Z')
  }, /attempt/)
  assert.throws(() => {
    order.sameAttempt(customer, '', '2026-11-20T11:00:00.000Z')
  }, /expired/)
})

void test('countries: any ISO code, named in French and English', () => {
  assert.equal(countryValue('CH'), 'CH')
  assert.equal(countryName('CH', 'fr'), 'Suisse')
  assert.equal(countryName('CH', 'en'), 'Switzerland')
  assert.ok(COUNTRY_CODES.includes('BE') && COUNTRY_CODES.length > 240)
  for (const bad of ['ch', 'XX', 'FRA', '', 1, null])
    assert.throws(() => countryValue(bad), /country/)
  assert.equal(EU_COUNTRIES.length, 27)
  assert.ok(isEuCountry('BE') && !isEuCountry('CH'))
})

void test('postal code: one generic rule for every country', () => {
  const base = { name: 'A', email: 'a@b.c', address: 'x', city: 'y' }
  for (const [country, postalCode] of [
    ['FR', '75004'],
    ['BE', '1000'],
    ['CH', '8001'],
    ['GB', 'SW1A 1AA'],
    ['PT', '1000-001'],
  ])
    assert.equal(customerValue({ ...base, country, postalCode }).postalCode, postalCode)
  for (const postalCode of ['', ' ', '-123', '12345678901', '75004!'])
    assert.throws(() => customerValue({ ...base, country: 'FR', postalCode }), /postal_code/)
})
