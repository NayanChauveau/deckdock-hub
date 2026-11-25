import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { getPayload } from 'payload'
import config from '../payload.config'
import { site } from '../core/site'
import { createOrders, orderPorts } from '../modules/orders/composition'
import { plainPersistence } from '../modules/orders/adapters/payload/persistence-extension'

const url = new URL(process.env['DATABASE_URL'] || '')
if (
  process.env.NODE_ENV === 'production' ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  !/(_dev|_test)$/.test(url.pathname)
)
  throw new Error('Démonstration autorisée uniquement dans une BDD locale _dev ou _test.')
const payload = await getPayload({ config })
try {
  await payload.updateGlobal({ slug: 'order-settings', data: { enabled: true } })
  for (const country of ['FR', 'BE'] as const) {
    const existing = await payload.find({
      collection: 'delivery-countries',
      where: { country: { equals: country } },
      limit: 1,
    })
    if (existing.docs[0])
      await payload.update({
        collection: 'delivery-countries',
        id: existing.docs[0].id,
        data: { open: true },
      })
    else await payload.create({ collection: 'delivery-countries', data: { country, open: true } })
  }
  // The demonstration shop is meant to be browsed: open it, unlike a real deployment.
  const settings = await payload.findGlobal({ slug: 'site-settings' })
  await payload.updateGlobal({
    slug: 'site-settings',
    data: { siteName: settings.siteName || site.identity.displayName, maintenance: false },
  })
  // One plain order (no selling module needed), waiting for payment: its private link opens the
  // tracking page, where the local payment simulation can be tried.
  const orders = createOrders(payload)
  const { uow, links } = orderPorts(payload, undefined, plainPersistence)
  const placed = await uow.run((tx) =>
    orders.place.within(tx, {
      attemptId: randomUUID(),
      locale: 'fr',
      customer: {
        name: 'Client de démonstration',
        email: 'demo@example.test',
        address: '1 rue de l’Exemple',
        postalCode: '75001',
        city: 'Paris',
        country: 'FR',
      },
      termsAccepted: true,
      lines: [{ label: 'Article de démonstration', unitCents: 2000, quantity: 1 }],
      shippingCents: 500,
      details: {},
    }),
  )
  const { order } = await orders.place.openPayment(placed)
  const demo = {
    reference: order.reference,
    token: orders.access.issue(order.reference),
    link: links.tracking(order),
  }
  // The HTTP and browser test suites read the demo order from this file.
  const output = process.env['DEMO_ORDER_FILE']
  if (output) await writeFile(output, JSON.stringify(demo), { mode: 0o600 })
  console.log(`Commandes ouvertes (FR, BE). Commande de démonstration : ${demo.link}`)
} finally {
  await payload.destroy()
}
