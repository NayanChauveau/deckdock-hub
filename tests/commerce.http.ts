import { ordersSettings } from '../src/modules/orders/settings'
import { z } from 'zod'
import { orderLinkSchema } from '../src/modules/orders/contracts'
import { orderCookieName } from '../src/modules/orders/reference'
import { trackingPath } from '../src/modules/orders/paths'
import { present } from './support/present'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { devOrigin } from '../src/core/site'
const demoOrderSchema = z.object({ reference: z.string(), token: z.string(), link: z.string() })
const origin = process.env['TEST_ORIGIN'] || devOrigin
if (!['localhost', '127.0.0.1'].includes(new URL(origin).hostname))
  throw new Error('Tests HTTP locaux uniquement.')
const request = (path: string, init?: RequestInit) => fetch(origin + path, init)
const headers = { Origin: origin }
for (const endpoint of ['access', 'simulate']) {
  const response = await request(`/api/commerce/${endpoint}`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference: 123, token: [] }),
  })
  assert.equal(response.status, 404, 'Malformed JSON data is rejected before use cases run')
}
for (const collection of ['orders', 'customer-photos', 'payment-events', 'email-outbox']) {
  assert.ok([401, 403].includes((await request(`/api/${collection}`)).status), collection)
}
for (const url of ['/api/customer-photos/file/photo.jpg', '/storage/media/private/photo.jpg']) {
  assert.ok((await request(url)).status >= 400, `Private uploads inaccessible: ${url}`)
}
// The order placed by src/scripts/commerce-demo.ts, waiting for payment (no selling module needed).
const demo = demoOrderSchema.parse(
  JSON.parse(await readFile(present(process.env['DEMO_ORDER_FILE']), 'utf8')) as unknown,
)
const cookie = `${orderCookieName(demo.reference)}=${encodeURIComponent(demo.token)}`
assert.match(cookie, new RegExp(`^${ordersSettings.accessCookiePrefix}`))
const forgedAccess = await request('/api/commerce/access', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ reference: demo.reference, token: 'x'.repeat(43), locale: 'en' }),
})
assert.equal(forgedAccess.status, 404, 'A forged token opens nothing')
const access = await request('/api/commerce/access', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    reference: demo.reference,
    token: demo.token,
    locale: 'en',
  }),
})
assert.equal(access.status, 200)
assert.match(present(access.headers.get('set-cookie')), /HttpOnly/i)
const trackingUrl = orderLinkSchema.parse((await access.json()) as unknown).url
assert.equal(trackingUrl, trackingPath('en', demo.reference))

const anonymous = await request(trackingUrl)
const deniedBody = await anonymous.text()
assert.ok(
  anonymous.status === 404 || deniedBody.includes('NEXT_HTTP_ERROR_FALLBACK;404'),
  'A reference alone grants no access, including streamed Next.js 404s',
)
assert.ok(!deniedBody.includes('demo@example.test'))
let page = await request(trackingUrl, { headers: { Cookie: cookie } })
assert.equal(page.status, 200)
assert.match(await page.text(), /Waiting for payment confirmation/)
assert.equal(
  (
    await request('/api/commerce/simulate', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference: demo.reference }),
    })
  ).status,
  404,
)
const retryBody = JSON.stringify({ reference: demo.reference })
const retryHeaders = { ...headers, 'Content-Type': 'application/json' }
const anonymousRetry = await request('/api/commerce/retry', {
  method: 'POST',
  headers: retryHeaders,
  body: retryBody,
})
assert.equal(anonymousRetry.status, 404, 'The order reference alone cannot restart payment')
const crossOriginRetry = await request('/api/commerce/retry', {
  method: 'POST',
  headers: { ...retryHeaders, Origin: 'https://untrusted.example', Cookie: cookie },
  body: retryBody,
})
assert.equal(crossOriginRetry.status, 403, 'Only the shop may initiate payment')
const simulated = await request('/api/commerce/simulate', {
  method: 'POST',
  headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ reference: demo.reference }),
})
assert.equal(simulated.status, 200, await simulated.clone().text())
page = await request(trackingUrl, { headers: { Cookie: cookie } })
assert.match(await page.text(), /Payment confirmed/)
assert.equal(
  (
    await request('/api/commerce/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'Stripe-Signature': 'invalid' },
    })
  ).status,
  503,
  'Unconfigured webhook never accepts unsigned data',
)
console.log(
  'HTTP commerce passed: FR/EN, private collections and uploads, signed access, secure cookie, private tracking, origin protection and local payment simulation.',
)
