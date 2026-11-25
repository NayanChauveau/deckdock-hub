import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DisabledPaymentGateway } from '../src/modules/orders/application/ports'
import type { OrderExtension } from '../src/modules/orders/application/extension'
import type { OrderDraft } from '../src/modules/orders/application/place'
import { enqueueOrderEvents } from '../src/modules/orders/application/notifications'
import type { OrderEvent } from '../src/modules/orders/domain/model'
import { present } from './support/present'
import { memoryOrders } from './support/in-memory-orders'

type System = ReturnType<typeof memoryOrders>
const attempt = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
const draft = (number = 1, change: Partial<OrderDraft> = {}) => ({
  attemptId: attempt(number),
  locale: 'fr',
  customer: {
    name: 'Test',
    email: 'test@example.test',
    address: '1 Test',
    address2: '',
    postalCode: '75001',
    city: 'Paris',
    country: 'FR',
  },
  termsAccepted: true,
  comment: '',
  lines: [{ label: 'Pièce unique', unitCents: 2000, quantity: 1 }],
  shippingCents: 400,
  details: {},
  ...change,
})
async function place(system: System, number = 1, change: Partial<OrderDraft> = {}) {
  const order = await system.store.run((tx) => system.app.place.within(tx, draft(number, change)))
  return system.app.place.openPayment(order)
}
const pay = (reference: string, eventId: string) => ({
  eventId,
  eventType: 'test.paid',
  reference,
  amount: 2400,
  currency: 'eur',
  state: 'paid' as const,
})
const ownerNotices = (system: System) =>
  system.store.notifications.filter((notice) => notice.kind === 'owner_new_order')

void test('a payment update for an unknown reference is acknowledged and changes nothing', async () => {
  const { app, store } = memoryOrders()
  await app.payments.applyVerified(pay('XX-0000000000000000', 'evt_1'))
  assert.equal(store.paymentEvents.size, 0)
  assert.equal(store.notifications.length, 0)
})

void test('without a payment provider, opening a payment fails with payment_unavailable', async () => {
  const { app, store } = memoryOrders({ payments: new DisabledPaymentGateway() })
  const order = await store.run((tx) => app.place.within(tx, draft()))
  await assert.rejects(app.place.openPayment(order), /payment_unavailable/)
  await assert.rejects(
    new DisabledPaymentGateway().verifyNotification(new Uint8Array(), 'sig'),
    /webhook_unavailable/,
  )
})

void test('an order whose kind has no extension is paid, administered and tracked', async () => {
  const system = memoryOrders()
  const placed = await place(system)
  assert.equal(placed.order.kind, 'plain')
  await system.app.payments.applyVerified(pay(placed.order.reference, 'evt-paid'))
  for (const fulfillmentStatus of ['in_progress', 'ready', 'shipped'] as const)
    await system.app.admin.execute(placed.order.id, { fulfillmentStatus }, 'admin')
  await assert.rejects(
    system.app.admin.execute(placed.order.id, { fulfillmentStatus: 'cancelled' }, 'admin'),
    { code: 'transition' },
  )
  const token = system.signer.orderToken(placed.order.reference)
  const view = await system.app.orders.tracking(placed.order.reference, token)
  assert.equal(view.fulfillmentStatus, 'shipped')
  assert.deepEqual(view.details, {})
  await assert.rejects(system.app.orders.tracking(placed.order.reference, 'bad'), {
    code: 'not_found',
  })
  await system.app.maintenance.execute()
  const kinds = system.store.notifications.map((notice) => [notice.kind, notice.status])
  assert.deepEqual(kinds, [
    ['confirmation', 'simulated'],
    ['shipped', 'simulated'],
  ])
  const confirmation = present(system.store.notifications[0])
  assert.match(present(confirmation.body), /Pièce unique/)
  assert.match(present(confirmation.body), new RegExp(placed.order.reference))
})

void test('the extension reacts to events inside the payment transaction', async () => {
  let fail = true
  const seen: OrderEvent['type'][] = []
  const extension: OrderExtension = {
    kind: 'test-item',
    afterEvents: async (events) => {
      if (fail) throw new Error('Extension unavailable')
      seen.push(...events.map((event) => event.type))
    },
  }
  const system = memoryOrders({ extension })
  const placed = await place(system)
  await assert.rejects(system.app.payments.applyVerified(pay(placed.order.reference, 'evt-ext')))
  assert.equal(present(system.store.orders.get(placed.order.id)).paymentStatus, 'pending')
  assert.equal(system.store.paymentEvents.size, 0)
  assert.equal(system.store.notifications.length, 0)
  fail = false
  await system.app.payments.applyVerified(pay(placed.order.reference, 'evt-ext'))
  assert.equal(present(system.store.orders.get(placed.order.id)).paymentStatus, 'paid')
  assert.ok(seen.includes('OrderPaymentConfirmed'))
})

void test('an extension notice is queued once and rendered by the extension', async () => {
  const rendered: string[] = []
  const extension: OrderExtension = {
    kind: 'test-item',
    emailFor: (order, notice) => {
      if (notice !== 'schedule_changed') return null
      rendered.push(notice)
      return {
        subject: `Nouvelle date — ${order.reference}`,
        document: {
          locale: 'fr',
          preheader: 'Nouvelle date.',
          eyebrow: 'Votre commande',
          title: 'Nouvelle date',
          intro: 'Nouvelle date.',
          sections: [],
          notes: [],
          signature: { label: 'Atelier test', url: 'https://test.invalid/fr' },
        },
      }
    },
    emailRows: () => [['Délai', '2 semaines']],
  }
  const system = memoryOrders({ extension })
  const placed = await place(system)
  await system.app.payments.applyVerified(pay(placed.order.reference, 'evt-paid'))
  for (const step of [1, 2])
    await system.store.run(async (tx) => {
      const order = present(await tx.orders.findById(placed.order.id))
      order.amendDetails({ step }, system.clock.instant, { notice: 'schedule_changed', key: 'k' })
      await tx.orders.save(order)
      await enqueueOrderEvents(order.releaseEvents(), tx)
    })
  const queued = system.store.notifications.filter((notice) => notice.kind === 'schedule_changed')
  assert.equal(queued.length, 1)
  assert.equal(present(queued[0]).key, `${placed.order.reference}:schedule_changed:k`)
  await system.app.maintenance.execute()
  assert.deepEqual(rendered, ['schedule_changed'])
  const notices = system.store.notifications
  assert.equal(
    notices.find((notice) => notice.kind === 'schedule_changed')?.subject,
    `Nouvelle date — ${placed.order.reference}`,
  )
  assert.match(
    present(notices.find((notice) => notice.kind === 'confirmation')?.body),
    /Délai : 2 semaines/,
  )
})

void test('placing an order is idempotent on the attempt and refused when orders are closed', async () => {
  const system = memoryOrders()
  const first = await system.store.run((tx) => system.app.place.within(tx, draft(1)))
  const again = await system.store.run((tx) => system.app.place.within(tx, draft(1)))
  assert.equal(again.snapshot.reference, first.snapshot.reference)
  assert.equal(system.store.orders.size, 1)
  await assert.rejects(
    system.store.run((tx) =>
      system.app.place.within(tx, draft(1, { comment: 'Une autre demande.' })),
    ),
    { code: 'attempt' },
  )
  system.store.settings.countries = ['FR']
  const belgian = { ...draft(2).customer, country: 'BE', postalCode: '1000' }
  await assert.rejects(
    system.store.run((tx) => system.app.place.within(tx, draft(2, { customer: belgian }))),
    { code: 'country' },
  )
  system.store.settings.enabled = false
  await assert.rejects(
    system.store.run((tx) => system.app.place.within(tx, draft(3))),
    { code: 'closed' },
  )
  assert.equal(system.store.orders.size, 1)
})

void test('the confirmation names a Swiss customer’s country in the order language', async () => {
  for (const [locale, name] of [
    ['fr', 'Suisse'],
    ['en', 'Switzerland'],
  ] as const) {
    const system = memoryOrders()
    system.store.settings.countries = ['CH']
    const customer = { ...draft(7).customer, country: 'CH', postalCode: '1000' }
    const placed = await place(system, 7, { customer, locale })
    await system.app.payments.applyVerified(pay(placed.order.reference, `evt-ch-${locale}`))
    await system.app.maintenance.execute()
    const confirmation = system.store.notifications.find((n) => n.kind === 'confirmation')
    assert.match(present(confirmation?.body), new RegExp(name))
  }
})

void test('the same event delivered twice is applied once', async () => {
  const system = memoryOrders()
  const placed = await place(system)
  await system.app.payments.applyVerified(pay(placed.order.reference, 'evt-twice'))
  await system.app.payments.applyVerified(pay(placed.order.reference, 'evt-twice'))
  assert.equal(system.store.paymentEvents.size, 1)
  assert.equal(system.store.notifications.length, 1)
  assert.equal(present(system.store.orders.get(placed.order.id)).history.length, 3)
})

void test('outbox failure rolls back payment and event deduplication atomically', async () => {
  const system = memoryOrders()
  const placed = await place(system)
  const run = system.store.run.bind(system.store)
  let fail = true
  system.store.run = (work) =>
    run((tx) =>
      work({
        ...tx,
        notifications: {
          ...tx.notifications,
          enqueue: async (...args) => {
            if (fail) throw new Error('Storage unavailable')
            return tx.notifications.enqueue(...args)
          },
        },
      }),
    )
  await assert.rejects(system.app.payments.applyVerified(pay(placed.order.reference, 'evt-atomic')))
  assert.equal(present(system.store.orders.get(placed.order.id)).paymentStatus, 'pending')
  assert.ok(!system.store.paymentEvents.has('evt-atomic'))
  fail = false
  await system.app.payments.applyVerified(pay(placed.order.reference, 'evt-atomic'))
  assert.equal(present(system.store.orders.get(placed.order.id)).paymentStatus, 'paid')
})

void test('placing requires accepted terms and records their version on the order', async () => {
  const system = memoryOrders()
  await assert.rejects(
    system.store.run((tx) => system.app.place.within(tx, draft(40, { termsAccepted: false }))),
    { code: 'terms' },
  )
  assert.equal(system.store.orders.size, 0)
  const placed = await place(system, 40)
  assert.equal(placed.order.termsVersion, 'test-terms')
  assert.equal(placed.order.termsAcceptedAt, placed.order.createdAt)
})

void test('switching to real SMTP never resends emails already handled in simulated mode', async () => {
  let real = false
  const sent: number[] = []
  const system = memoryOrders({
    mailer: {
      deliver: async (_order, notice) => {
        if (!real) return { status: 'simulated', text: '' }
        sent.push(notice.orderId)
        return { status: 'sent', text: '' }
      },
    },
  })
  const before = await place(system, 1)
  await system.app.payments.applyVerified(pay(before.order.reference, 'evt-before'))
  await system.app.maintenance.execute()
  assert.ok(system.store.notifications.length > 0)
  assert.ok(system.store.notifications.every((notice) => notice.status === 'simulated'))
  real = true
  await system.app.maintenance.execute()
  assert.deepEqual(sent, [])
  const after = await place(system, 2)
  await system.app.payments.applyVerified(pay(after.order.reference, 'evt-after'))
  await system.app.maintenance.execute()
  assert.ok(sent.length > 0)
  assert.ok(sent.every((orderId) => orderId === after.order.id))
})

void test('a failed delivery is retried later with back-off', async () => {
  let attempts = 0
  const system = memoryOrders({
    mailer: {
      deliver: async () => {
        attempts++
        if (attempts === 1) throw new Error('SMTP down')
        return { status: 'sent', text: '' }
      },
    },
  })
  const placed = await place(system)
  await system.app.payments.applyVerified(pay(placed.order.reference, 'evt-paid'))
  await system.app.maintenance.execute()
  assert.equal(present(system.store.notifications[0]).status, 'failed')
  await system.app.maintenance.execute()
  assert.equal(attempts, 1)
  system.clock.advance(120_000)
  await system.app.maintenance.execute()
  assert.equal(present(system.store.notifications[0]).status, 'sent')
})

void test('a paid order notifies the configured owner address once, without the private tracking link', async () => {
  const silent = memoryOrders()
  const first = await place(silent)
  await silent.app.payments.applyVerified(pay(first.order.reference, 'evt-silent'))
  assert.equal(ownerNotices(silent).length, 0)
  const system = memoryOrders()
  system.store.settings.ownerEmail = 'atelier@example.test'
  const placed = await place(system)
  await system.app.payments.applyVerified(pay(placed.order.reference, 'evt-owner'))
  await system.app.payments.applyVerified(pay(placed.order.reference, 'evt-owner-replay'))
  await system.app.maintenance.execute()
  const notices = ownerNotices(system)
  assert.equal(notices.length, 1)
  assert.equal(present(notices[0]).status, 'simulated')
  const body = present(present(notices[0]).body)
  assert.match(
    body,
    new RegExp(`${placed.order.reference}[\\s\\S]*https://test.invalid/admin/${placed.order.id}`),
  )
  assert.doesNotMatch(body, /test\.invalid\/TS-/)
})

void test('retry preserves the order and reuses or replaces checkout without opening duplicate payments', async () => {
  const system = memoryOrders()
  system.gateway.mode = () => 'sandbox'
  const sessions = new Map<string, Awaited<ReturnType<typeof system.gateway.readSession>>>()
  system.gateway.createSession = async (order) => {
    const id = `test-session-${sessions.size + 1}`
    const session = {
      id,
      reference: order.reference,
      amount: order.totalCents,
      currency: 'EUR',
      paid: false,
      expired: false,
      open: true,
      url: `https://checkout.example.test/${id}`,
    }
    sessions.set(id, session)
    return session
  }
  system.gateway.readSession = async (id) => present(sessions.get(id))
  const placed = await place(system, 1, { comment: 'Emballage cadeau.' })
  const { reference, id } = placed.order
  const token = system.signer.orderToken(reference)
  const previous = present(sessions.get(present(placed.order.paymentSessionId)))
  await assert.rejects(system.app.payments.retry(reference, 'bad'), { code: 'not_found' })
  assert.equal((await system.app.payments.retry(reference, token)).url, placed.url)
  assert.equal(sessions.size, 1)
  previous.open = false
  previous.url = null
  await assert.rejects(system.app.payments.retry(reference, token), { code: 'payment_state' })
  previous.expired = true
  const [first, second] = await Promise.all([
    system.app.payments.retry(reference, token),
    system.app.payments.retry(reference, token),
  ])
  assert.equal(first.url, second.url)
  assert.equal(sessions.size, 2)
  assert.equal(system.store.orders.size, 1)
  const replacement = present(system.store.orders.get(id))
  assert.equal(replacement.customerComment, 'Emballage cadeau.')
  assert.equal(replacement.totalCents, placed.order.totalCents)
  await system.app.payments.applyVerified({
    ...pay(reference, 'late-expiration'),
    state: 'expired' as const,
    sessionId: previous.id,
  })
  assert.equal(present(system.store.orders.get(id)).paymentStatus, 'pending')
  const current = present(sessions.get(present(replacement.paymentSessionId)))
  current.paid = true
  assert.deepEqual(await system.app.payments.retry(reference, token), { url: null })
  await system.app.payments.applyVerified({
    ...pay(reference, 'confirmed-retry'),
    sessionId: current.id,
  })
  assert.equal(present(system.store.orders.get(id)).fulfillmentStatus, 'queued')
  await assert.rejects(system.app.payments.retry(reference, token), { code: 'expired' })
  assert.equal(sessions.size, 2)
})

void test('an extension can refuse a payment retry', async () => {
  const system = memoryOrders({
    extension: { kind: 'test-item', canRetryPayment: () => false },
  })
  system.gateway.mode = () => 'sandbox'
  const placed = await place(system)
  const token = system.signer.orderToken(placed.order.reference)
  await assert.rejects(system.app.payments.retry(placed.order.reference, token), {
    code: 'expired',
  })
  const view = await system.app.orders.tracking(placed.order.reference, token)
  assert.equal(view.canRetry, false)
})
