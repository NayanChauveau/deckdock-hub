import { present } from './support/present'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ValidationError, getPayload } from 'payload'
import config from '../src/payload.config'
import { createOrders, orderPorts } from '../src/modules/orders/composition'
import { plainPersistence } from '../src/modules/orders/adapters/payload/persistence-extension'
import { countryName } from '../src/core/domain/countries'
import type { OrderDraft } from '../src/modules/orders/application/place'

// Generic orders on the real adapters: placed as plain orders (no selling module), the way a
// selling module places its own inside its transaction.
if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Base isolée _test requise.')
process.env['COMMERCE_PAYMENT_MODE'] = 'simulated'
process.env['EMAIL_MODE'] = 'simulated'
const payload = await getPayload({ config })
const commerce = createOrders(payload)
const { uow } = orderPorts(payload, undefined, plainPersistence)
const prefix = randomUUID()
try {
  // On a new database the migration opens France and Belgium (the old default); this test
  // opens its own countries.
  await payload.delete({
    collection: 'delivery-countries',
    where: { country: { in: ['FR', 'BE'] } },
  })
  assert.equal(
    (await payload.count({ collection: 'orders' })).totalDocs,
    0,
    'Utiliser une nouvelle base de test sans commandes pour chaque exécution.',
  )
  await payload.updateGlobal({ slug: 'order-settings', data: { enabled: true } })
  for (const country of ['FR', 'BE'] as const)
    await payload.create({ collection: 'delivery-countries', data: { country, open: true } })
  const termsVersion = 'test-2026-11-19'
  await payload.updateGlobal({
    slug: 'legal-pages',
    data: {
      legalNotice: { title: 'Mentions légales' },
      terms: { title: 'Conditions générales de vente', version: termsVersion },
      privacy: { title: 'Politique de confidentialité' },
    },
  })
  for (const collection of [
    'orders',
    'payment-events',
    'email-outbox',
    'commerce-rate-limits',
  ] as const)
    await assert.rejects(payload.find({ collection, overrideAccess: false }))
  await assert.rejects(payload.findGlobal({ slug: 'order-settings', overrideAccess: false }))

  const draft = (country: string, overrides: Partial<OrderDraft> = {}): OrderDraft => ({
    attemptId: randomUUID(),
    locale: 'fr',
    customer: {
      name: 'Test Client',
      email: 'client@example.test',
      address: '1 rue Test',
      address2: '',
      postalCode: country === 'FR' ? '75001' : '1000',
      city: 'Test',
      country,
    },
    termsAccepted: true,
    lines: [{ label: 'Article', unitCents: 2000, quantity: 1 }],
    shippingCents: country === 'FR' ? 400 : 900,
    details: {},
    ...overrides,
  })
  const place = (value: OrderDraft) =>
    uow.run((tx) => commerce.place.within(tx, value)).then((order) => order.snapshot)
  const code = (expected: string) => (error: unknown) =>
    error instanceof Error && 'code' in error && error.code === expected

  const request1 = draft('FR', { comment: '  Laisser au gardien.\nMerci.  ' })
  const first = await place(request1)
  assert.equal(first.totalCents, 2400)
  assert.equal(first.kind, plainPersistence.kind)
  assert.equal(first.customerComment, 'Laisser au gardien.\nMerci.')
  assert.equal(
    (await payload.findByID({ collection: 'orders', id: first.id })).customerComment,
    first.customerComment,
  )
  await assert.rejects(place({ ...request1, comment: 'Autre instruction' }), code('attempt'))
  await assert.rejects(place(draft('FR', { comment: 'x'.repeat(2001) })), code('comment'))
  assert.equal((await place(request1)).id, first.id, 'Checkout retries reuse one order')
  const second = await place(
    draft('BE', { lines: [{ label: 'Article', unitCents: 2500, quantity: 2 }] }),
  )
  assert.equal(second.shippingCents, 900)
  assert.equal(second.customerComment, '')
  assert.equal(second.totalCents, 5900)
  assert.equal(first.termsVersion, termsVersion, 'Version des CGV figée dans la commande')
  assert.ok(
    (await payload.findByID({ collection: 'orders', id: first.id, depth: 0 })).termsAcceptedAt,
  )
  await assert.rejects(place(draft('FR', { termsAccepted: false })), code('terms'))
  await assert.rejects(place(draft('FR', { attemptId: 'not-a-uuid' })), code('attempt'))
  await assert.rejects(
    place({ ...draft('FR'), customer: { ...draft('FR').customer, country: 'DE' } }),
  )
  // Countries are opened from the administration: open ones are read, closed ones refuse orders.
  await payload.create({ collection: 'delivery-countries', data: { country: 'CH', open: true } })
  await payload.create({ collection: 'delivery-countries', data: { country: 'DE', open: false } })
  await assert.rejects(
    payload.create({ collection: 'delivery-countries', data: { country: 'CH', open: false } }),
    'A country is listed once',
  )
  const readCountries = async () => (await uow.read((tx) => tx.settings())).countries
  const open = await readCountries()
  assert.ok(open.includes('CH') && !open.includes('DE'))
  assert.deepEqual(
    open,
    [...open].sort((a, b) => countryName(a, 'fr').localeCompare(countryName(b, 'fr'), 'fr')),
    'Sorted by French name',
  )
  const swiss = await place(draft('CH', { shippingCents: 900 }))
  assert.equal(swiss.customer.country, 'CH')
  await assert.rejects(place(draft('DE')), code('country'))
  const opened = await commerce.place.openPayment(
    present(await uow.read((tx) => tx.orders.findById(first.id))),
  )
  assert.ok(opened.simulated, 'Only local simulation is exercised by this test')

  const read = (id: number) => payload.findByID({ collection: 'orders', id, depth: 0 })
  const paid = (order: typeof first, eventId: string) =>
    commerce.payments.applyVerified({
      eventId,
      eventType: 'test.paid',
      reference: order.reference,
      paymentId: `pi_${order.reference}`,
      amount: order.totalCents,
      currency: 'eur',
      state: 'paid',
    })
  await Promise.all([
    paid(first, `${prefix}:first`),
    paid(first, `${prefix}:first`),
    paid(second, `${prefix}:second`),
  ])
  assert.equal(
    (
      await payload.count({
        collection: 'payment-events',
        where: { eventId: { equals: `${prefix}:first` } },
      })
    ).totalDocs,
    1,
  )
  const before = await read(first.id)
  const secondPaid = await read(second.id)
  assert.equal(before.paymentStatus, 'paid')
  assert.equal(before.fulfillmentStatus, 'queued')
  assert.equal(secondPaid.paymentStatus, 'paid')
  assert.equal(
    (
      await payload.count({
        collection: 'email-outbox',
        where: { key: { equals: `${before.reference}:confirmation:` } },
      })
    ).totalDocs,
    1,
  )
  await commerce.payments.applyVerified({
    eventId: `${prefix}:late-expiry`,
    eventType: 'test.expired',
    reference: before.reference,
    amount: 2400,
    currency: 'eur',
    state: 'expired',
  })
  assert.equal(
    (await read(before.id)).paymentStatus,
    'paid',
    'Out-of-order expiry never regresses payment',
  )
  await assert.rejects(
    commerce.payments.applyVerified({
      eventId: `${prefix}:bad-amount`,
      eventType: 'test.paid',
      reference: before.reference,
      amount: 1,
      currency: 'eur',
      state: 'paid',
    }),
  )
  const admin = await payload.create({
    collection: 'users',
    data: {
      email: `${prefix}@example.test`,
      password: randomUUID() + randomUUID(),
      name: 'Test Admin',
      role: 'admin',
    },
  })
  const user = { ...admin, collection: 'users' as const }
  await assert.rejects(
    payload.update({
      collection: 'orders',
      id: before.id,
      user,
      overrideAccess: false,
      data: { totalCents: 1 },
    }),
  )
  // A business refusal reaches the administration as a public 400 with its French message, on the field.
  const unpaid = await place(draft('FR', { attemptId: randomUUID() }))
  const refused = await payload
    .update({
      collection: 'orders',
      id: unpaid.id,
      data: { fulfillmentStatus: 'in_progress' },
      user,
      overrideAccess: false,
    })
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  assert.ok(refused instanceof ValidationError, 'An unpaid order refuses a status change')
  assert.equal(refused.status, 400)
  assert.deepEqual(
    refused.data.errors.map((entry) => [entry.path, entry.message]),
    [
      [
        'fulfillmentStatus',
        'Le paiement doit être confirmé (Payé) avant de changer la réalisation.',
      ],
    ],
  )
  assert.equal((await read(unpaid.id)).fulfillmentStatus, 'awaiting_payment')
  await payload.updateGlobal({
    slug: 'legal-pages',
    data: { terms: { title: 'Conditions générales de vente', version: 'test-nouvelle' } },
  })
  assert.equal((await read(before.id)).termsVersion, termsVersion, 'Accepted terms stay frozen')
  for (const fulfillmentStatus of ['in_progress', 'ready', 'shipped'] as const)
    await payload.update({
      collection: 'orders',
      id: before.id,
      data: { fulfillmentStatus },
      user,
      overrideAccess: false,
    })
  assert.ok((await read(before.id)).shippedAt)
  assert.equal(
    (await payload.findByID({ collection: 'orders', id: before.id, showHiddenFields: true }))
      .attemptId,
    first.attemptId,
    'Hidden idempotency key survives native admin updates',
  )
  await payload.update({
    collection: 'orders',
    id: before.id,
    data: { internalNote: 'Note admin' },
    user,
    overrideAccess: false,
  })
  await assert.rejects(
    payload.update({
      collection: 'orders',
      id: first.id,
      data: { customerComment: 'Modification interdite' },
      user,
      overrideAccess: false,
    }),
  )
  assert.equal((await read(before.id)).paymentStatus, 'paid')
  await commerce.maintenance.execute()
  const emails = await payload.find({
    collection: 'email-outbox',
    where: { order: { equals: before.id } },
    pagination: false,
  })
  for (const kind of ['confirmation', 'shipped'])
    assert.ok(
      emails.docs.some(
        (email) =>
          email.kind === kind &&
          email.status === 'simulated' &&
          email.body?.includes(before.reference),
      ),
      kind,
    )
  await commerce.payments.applyVerified({
    eventId: `${prefix}:refund`,
    eventType: 'test.refund',
    reference: secondPaid.reference,
    paymentId: `pi_${secondPaid.reference}`,
    amount: present(secondPaid.totalCents),
    currency: 'eur',
    state: 'refunded',
  })
  assert.equal((await read(secondPaid.id)).paymentStatus, 'refunded')
  assert.equal((await read(secondPaid.id)).fulfillmentStatus, 'cancelled')
  await payload.updateGlobal({ slug: 'order-settings', data: { enabled: false } })
  await assert.rejects(place(draft('FR')), code('closed'))
  console.log(
    'Commerce integration passed: private access, retries, frozen terms, concurrent/deduplicated payments, admin transitions, simulated emails and refunds.',
  )
} finally {
  await payload.destroy()
}
