import { renderEmailHtml, renderEmailText } from '../src/modules/orders/adapters/email/layout'
import type { EmailDocument } from '../src/modules/orders/application/email-document'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { mock, test } from 'node:test'
import { RequestError, boundedBody, sameOrigin } from '../src/core/http/request-guards'
import { devOrigin } from '../src/core/site'
import { logger } from '../src/core/logger'
import { errorResponse } from '../src/modules/orders/adapters/http/errors'
import {
  OrderSettings,
  ordersCollections,
} from '../src/modules/orders/adapters/payload/collections'
import { deliveryCountries } from '../src/modules/orders/adapters/payload/delivery-countries'
import { orderFromDoc, orderToDoc } from '../src/modules/orders/adapters/payload/mapper'
import {
  plainPersistence,
  type OrderPersistenceExtension,
} from '../src/modules/orders/adapters/payload/persistence-extension'
import { HmacSigner } from '../src/modules/orders/adapters/security/hmac'
import { OrderError } from '../src/modules/orders/domain/errors'
import type { OrderDetails, OrderSnapshot } from '../src/modules/orders/domain/model'
import { customerValue } from '../src/modules/orders/domain/value-objects'
import type { Order } from '../src/payload-types'

const day = '2026-11-18T12:00:00.000Z'
const fullOrder: Omit<OrderSnapshot, 'details'> = {
  id: 0,
  reference: 'AB-0123456789ABCDEF',
  attemptId: '00000000-0000-4000-8000-000000000001',
  locale: 'en',
  kind: 'plain',
  customer: {
    name: 'Test',
    email: 'test@example.test',
    address: '1 Test',
    address2: 'Floor 2',
    postalCode: '1000',
    city: 'Bruxelles',
    country: 'BE',
  },
  lines: [{ label: 'Item', unitCents: 9000, quantity: 1 }],
  itemsCents: 9000,
  shippingCents: 900,
  totalCents: 9900,
  currency: 'EUR',
  paymentStatus: 'paid',
  fulfillmentStatus: 'shipped',
  paymentSessionId: 'opaque-session',
  paymentId: 'opaque-payment',
  paymentExpiresAt: day,
  paidAt: day,
  shippedAt: day,
  trackingNumber: null,
  customerComment: '',
  internalNote: null,
  termsVersion: '2026-11-08',
  termsAcceptedAt: day,
  history: [],
  createdAt: day,
  updatedAt: day,
}
const plainDoc = {
  ...orderToDoc({ ...fullOrder, details: {} }, plainPersistence),
  id: 2,
  createdAt: day,
  updatedAt: day,
}

/** A selling module's persistence: its details live in real columns of `orders`. */
interface EngravingDetails extends OrderDetails {
  engraving: string
  photoId: number | null
}
const engravingPersistence: OrderPersistenceExtension<EngravingDetails> = {
  kind: 'engraving',
  fields: [],
  detailsToDoc: (details) => ({ engraving: details.engraving, photo: details.photoId }),
  detailsFromDoc: (doc) => ({
    engraving: typeof doc['engraving'] === 'string' ? doc['engraving'] : '',
    photoId: typeof doc['photo'] === 'number' ? doc['photo'] : null,
  }),
  application: () => ({ kind: 'engraving' }),
}

void test('the mapper round-trips every generic and extension field and translates nothing away', () => {
  const state: OrderSnapshot<EngravingDetails> = {
    ...fullOrder,
    kind: 'engraving',
    lines: [{ label: 'Gravure A4', unitCents: 9000, quantity: 1 }],
    details: { engraving: 'Texte', photoId: 7 },
    trackingNumber: '6A123',
    internalNote: 'n',
    customerComment: 'c',
    history: [{ at: day, action: 'created' }],
  }
  const doc = orderToDoc(state, engravingPersistence)
  assert.equal(doc['paymentSessionId'], state.paymentSessionId)
  assert.equal(doc['paymentId'], state.paymentId)
  assert.equal(doc['photo'], 7)
  assert.equal(doc['engraving'], 'Texte')
  assert.deepEqual(
    orderFromDoc({ ...doc, id: 1, createdAt: day, updatedAt: day } as Order, engravingPersistence)
      .snapshot,
    { ...state, id: 1, createdAt: day, updatedAt: day },
  )
  const hidden: Record<string, unknown> = { ...doc, id: 1, createdAt: day, updatedAt: day }
  Reflect.deleteProperty(hidden, 'attemptId')
  assert.throws(() => orderFromDoc(hidden as unknown as Order, engravingPersistence), /tentative/)
})

void test('a document of an unregistered kind maps with empty details', () => {
  assert.deepEqual(
    orderFromDoc({ ...plainDoc, kind: 'removed-module' } as Order, plainPersistence).snapshot
      .details,
    {},
  )
  assert.deepEqual(
    orderFromDoc({ ...plainDoc, kind: 'removed-module' } as Order, engravingPersistence).snapshot
      .details,
    {},
  )
})

void test('private tracking tokens and origin check', () => {
  const signer = new HmacSigner('test-secret-of-at-least-32-characters')
  const token = signer.orderToken('AB-AAAAAAAAAAAAAAAA')
  assert.ok(signer.verifyOrderToken('AB-AAAAAAAAAAAAAAAA', token))
  assert.ok(!signer.verifyOrderToken('AB-BBBBBBBBBBBBBBBB', token))
  assert.ok(!signer.verifyOrderToken('AB-AAAAAAAAAAAAAAAA', 'short'))
  process.env['APP_URL'] = devOrigin
  assert.throws(() => {
    sameOrigin(new Request(devOrigin, { headers: { origin: 'https://attacker.test' } }))
  }, RequestError)
})

void test('body is bounded even without content-length', async () => {
  await assert.rejects(
    boundedBody(new Request('http://localhost', { method: 'POST', body: '123456' }), 4),
    RequestError,
  )
})

void test('country and postal validation is authoritative', () => {
  const form = new FormData()
  for (const [key, value] of Object.entries({
    name: 'Test',
    email: 'TEST@example.test',
    address: '1 rue de test',
    address2: '',
    country: 'BE',
    postalCode: '1000',
    city: 'Bruxelles',
  }))
    form.set(key, value)
  assert.equal(customerValue(Object.fromEntries(form)).email, 'test@example.test')
  form.set('postalCode', '75000!')
  assert.throws(() => customerValue(Object.fromEntries(form)), OrderError)
  form.set('country', 'XX')
  assert.throws(() => customerValue(Object.fromEntries(form)), OrderError)
})

async function files(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name))
}

void test('HTTP routes depend on use cases rather than ORM or payment SDKs', async () => {
  const handlers = [
    ...(await files(path.resolve('src/app/(frontend)/api/commerce'))),
    ...(await files(path.resolve('src/modules'))).filter((file) =>
      /\/http\/[^/]+-route\.ts$/.test(file),
    ),
  ]
  // Payment handlers (payments-stripe) are checked too while that module is kept.
  assert.ok(handlers.some((file) => file.endsWith('access-route.ts')))
  for (const file of handlers) {
    const content = await readFile(file, 'utf8')
    assert.ok(
      !/from ['"](?:payload|stripe|@payload-config)|payload-types|\.findByID\(|\.findGlobal\(/.test(
        content,
      ),
      `${file}: bypasses application`,
    )
  }
})

void test('order route errors that are not OrderError are logged with message and stack', () => {
  const spy = mock.method(logger, 'error', () => undefined)
  const response = errorResponse(new TypeError('stripe exploded'))
  assert.equal(response.status, 503)
  assert.equal(spy.mock.callCount(), 1)
  const [fields, message] = spy.mock.calls[0]?.arguments ?? []
  assert.equal(message, 'commerce_request_failed')
  assert.equal((fields as { err: Error }).err.message, 'stripe exploded')
  spy.mock.restore()
})

void test('order settings are a private global, wrapped by the second factor', () => {
  assert.equal(OrderSettings.custom, undefined)
})

void test('delivery countries: an open flag, then the extension fields; orders keep the country as text', () => {
  const extra = { name: 'rate', type: 'number' } as const
  const collection = deliveryCountries({ ...plainPersistence, countryFields: [extra] })
  assert.equal(collection.slug, 'delivery-countries')
  assert.deepEqual(
    collection.fields.map((field) => ('name' in field ? field.name : '')),
    ['name', 'country', 'open', 'rate'],
  )
  assert.equal(collection.admin?.useAsTitle, 'name')
  assert.ok(ordersCollections(undefined).some((c) => c.slug === 'delivery-countries'))
  assert.ok(!OrderSettings.fields.some((field) => 'name' in field && field.name === 'countries'))
  const orders = ordersCollections(undefined).find((c) => c.slug === 'orders')
  const group = JSON.stringify(orders?.fields)
  assert.match(group, /"name":"country","label":"Pays","type":"text"/)
})

void test('order status fields: described, not clearable, no manual awaiting payment, tracking always visible', () => {
  const orders = ordersCollections(undefined).find((c) => c.slug === 'orders')
  const row = orders?.fields[0]
  const status = (row && 'fields' in row ? row.fields : []).find(
    (field) => 'name' in field && field.name === 'fulfillmentStatus',
  )
  assert.ok(status && status.type === 'select')
  assert.match(status.admin?.description as string, /^Passer à « Expédié » envoie aussitôt l’email/)
  assert.match(status.admin?.description as string, /remboursement se fait dans Stripe/)
  assert.equal(status.admin?.isClearable, false)
  const filter = status.filterOptions as unknown as (args: {
    options: unknown
    siblingData: Record<string, unknown>
  }) => { value: string }[]
  const offered = (current: string) =>
    filter({ options: status.options, siblingData: { fulfillmentStatus: current } }).map(
      (option) => option.value,
    )
  assert.deepEqual(offered('queued'), ['queued', 'in_progress', 'ready', 'shipped', 'cancelled'])
  // The stored value of an unpaid order stays valid: it is shown while it is the current one.
  assert.equal(offered('awaiting_payment')[0], 'awaiting_payment')
  const tracking = orders?.fields.find(
    (field) => 'name' in field && field.name === 'trackingNumber',
  )
  assert.ok(tracking && tracking.type === 'text')
  assert.equal(tracking.admin?.condition, undefined)
  assert.equal(
    tracking.admin?.description,
    'À remplir avant de passer la commande à « Expédié » : il figure dans l’email d’expédition.',
  )
})

void test('the customer group is open and labelled in French; the country shows its French name', () => {
  const orders = ordersCollections(undefined).find((c) => c.slug === 'orders')
  const collapsible = orders?.fields.find(
    (field) => field.type === 'collapsible' && field.label === 'Client et livraison',
  )
  assert.ok(collapsible && collapsible.type === 'collapsible')
  assert.equal(collapsible.admin?.initCollapsed, false)
  const group = collapsible.fields.find((field) => 'name' in field && field.name === 'customer')
  assert.ok(group && group.type === 'group')
  assert.equal(group.label, 'Client')
  const fields = group.fields.map((field) => [
    'name' in field ? field.name : '',
    'label' in field ? field.label : '',
  ])
  assert.deepEqual(fields, [
    ['name', 'Nom'],
    ['email', 'Email'],
    ['address', 'Adresse'],
    ['address2', 'Complément d’adresse'],
    ['postalCode', 'Code postal'],
    ['city', 'Ville'],
    ['country', 'Pays'],
  ])
  const country = group.fields[6]
  assert.equal(country?.admin?.components?.Field, '/modules/orders/admin/OrderCountry#OrderCountry')
})

void test('the email adapter renders a document as escaped HTML and as plain text', () => {
  const document: EmailDocument = {
    locale: 'fr',
    preheader: 'Merci',
    eyebrow: 'Votre commande',
    title: 'Commande <confirmée>',
    intro: 'Bonjour & merci.',
    sections: [{ rows: [['Montant', '42,50 €']] }],
    action: { label: 'Suivre', url: 'https://shop.example.test/suivi?a=1&b=2' },
    notes: [],
    signature: { label: 'Atelier', url: 'https://shop.example.test' },
  }
  const html = renderEmailHtml(document, { name: 'Atelier', domain: 'shop.example.test' })
  assert.match(html, /Commande &lt;confirmée&gt;/)
  assert.match(html, /Bonjour &amp; merci\./)
  assert.match(html, /href="https:\/\/shop\.example\.test\/suivi\?a=1&amp;b=2"/)
  assert.doesNotMatch(html, /<confirmée>/)
  const text = renderEmailText(document)
  assert.match(text, /Montant : 42,50 €/)
  assert.match(text, /Suivre :\nhttps:\/\/shop\.example\.test\/suivi\?a=1&b=2/)
  assert.doesNotMatch(text, /</)
})
