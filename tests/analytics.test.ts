import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { NextRequest } from 'next/server'
import {
  BEFORE_SEND,
  PURCHASE_EVENT,
  activeAnalytics,
  analyticsScripts,
  beforeSendScript,
  privatePaths,
  purchaseEvent,
  reportPurchase,
} from '../src/core/http/analytics'
import { contentSecurityPolicy } from '../src/core/http/csp'
import { parseSite, site } from '../src/core/site'
import { proxy } from '../src/proxy'

const raw = () => JSON.parse(readFileSync('site.config.json', 'utf8')) as Record<string, unknown>
const umami = {
  host: 'https://stats.example.test',
  websiteId: '3f1c2a4e-8b7d-4c6e-9a5f-1e2d3c4b5a69',
}
const directive = (policy: string, name: string) =>
  policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `)) ?? ''

void test('analytics is optional: absent or null is off, a valid one is kept', () => {
  const absent = raw()
  delete absent['analytics']
  assert.equal(parseSite(absent).analytics, undefined)
  assert.equal(parseSite({ ...raw(), analytics: null }).analytics, null)
  assert.deepEqual(parseSite({ ...raw(), analytics: umami }).analytics, umami)
})

void test('analytics needs an https origin and a website UUID, nothing else', () => {
  for (const analytics of [
    { ...umami, host: 'http://stats.example.test' },
    { ...umami, host: 'https://stats.example.test/' },
    { ...umami, host: 'https://stats.example.test/umami' },
    { ...umami, host: 'stats.example.test' },
    { ...umami, websiteId: 'not-a-uuid' },
    { ...umami, websiteId: '' },
    { host: umami.host },
    { ...umami, domains: 'example.test' },
  ])
    assert.throws(() => parseSite({ ...raw(), analytics }), /site\.config\.json: analytics/)
})

void test('only production builds measure: never next dev nor the test suites', () => {
  assert.deepEqual(activeAnalytics({ analytics: umami }, 'production'), umami)
  assert.equal(activeAnalytics({ analytics: umami }, 'development'), null)
  assert.equal(activeAnalytics({ analytics: umami }, 'test'), null)
  assert.equal(activeAnalytics({ analytics: null }, 'production'), null)
  assert.equal(activeAnalytics({}, 'production'), null)
})

void test('CSP: the analytics origin in script-src and connect-src of public pages only', () => {
  const policy = contentSecurityPolicy({
    nonce: 'n',
    admin: false,
    dev: false,
    analytics: umami.host,
  })
  assert.equal(
    directive(policy, 'script-src'),
    `script-src 'self' 'nonce-n' 'strict-dynamic' ${umami.host}`,
  )
  assert.equal(directive(policy, 'connect-src'), `connect-src 'self' ${umami.host}`)
  assert.equal(directive(policy, 'img-src'), "img-src 'self' data: blob:")
  assert.equal(directive(policy, 'frame-src'), "frame-src 'none'")
  const admin = contentSecurityPolicy({
    nonce: 'n',
    admin: true,
    dev: false,
    analytics: umami.host,
  })
  assert.ok(!admin.includes(umami.host))
  const off = contentSecurityPolicy({ nonce: 'n', admin: false, dev: false, analytics: null })
  assert.equal(directive(off, 'connect-src'), "connect-src 'self'")
  assert.equal(directive(off, 'script-src'), "script-src 'self' 'nonce-n' 'strict-dynamic'")
})

void test('the proxy allows the configured analytics on public pages of a production build', () => {
  const env = process.env as Record<string, string | undefined>
  const previous = env['NODE_ENV']
  env['NODE_ENV'] = 'production'
  try {
    const policy = (path: string) =>
      proxy(new NextRequest(`http://localhost${path}`)).headers.get('content-security-policy') ?? ''
    const host = site.analytics?.host
    if (host) {
      assert.ok(directive(policy('/fr'), 'connect-src').includes(host))
      assert.ok(directive(policy('/en/commande'), 'script-src').includes(host))
      assert.ok(!policy('/admin').includes(host))
      assert.ok(!policy('/admin/collections/orders').includes(host))
    } else assert.equal(directive(policy('/fr'), 'connect-src'), "connect-src 'self'")
  } finally {
    env['NODE_ENV'] = previous
  }
  assert.equal(
    directive(
      proxy(new NextRequest('http://localhost/fr')).headers.get('content-security-policy') ?? '',
      'connect-src',
    ),
    "connect-src 'self'",
    'Not outside production',
  )
})

const orders = {
  identity: { locales: ['fr', 'en'] },
  modules: {
    orders: {
      trackingPath: '/{locale}/commande/suivi/{reference}',
      accessPath: '/{locale}/commande/acces',
    },
  },
}

void test('private pages: order tracking and access, in every language', () => {
  const pattern = privatePaths(orders)
  assert.ok(pattern)
  for (const path of [
    '/fr/commande/suivi/EX-2026-ABC123',
    '/en/commande/suivi/EX-2026-ABC123/',
    '/fr/commande/acces',
    '/en/commande/acces/',
  ])
    assert.ok(pattern.test(path), path)
  for (const path of ['/fr', '/fr/commande', '/fr/commande/accessoires', '/de/commande/acces'])
    assert.ok(!pattern.test(path), path)
})

function beforeSend(origin: string, pattern: RegExp | null) {
  const window: Record<string, unknown> = {}
  runInNewContext(beforeSendScript(pattern), {
    window,
    location: new URL(`${origin}/fr`),
    URL,
    URLSearchParams,
  })
  const filter = window[BEFORE_SEND] as (type: string, payload: object) => object | null
  // Objects made in the script's own realm: compared as plain data.
  return (type: string, payload: object) =>
    JSON.parse(JSON.stringify(filter(type, payload))) as Record<string, unknown> | null
}

void test('before sending: private pages dropped, only utm_* kept, no fragment', () => {
  const origin = 'https://shop.example.test'
  const send = beforeSend(origin, privatePaths(orders))
  assert.equal(send('event', { url: `${origin}/fr/commande/suivi/EX-1?t=1`, referrer: '' }), null)
  assert.equal(send('event', { url: `${origin}/en/commande/acces`, referrer: '' }), null)
  assert.deepEqual(
    send('event', {
      url: `${origin}/fr/commande?utm_source=insta&utm_campaign=noel&email=a%40b.c#top`,
      referrer: 'https://www.google.com/search?q=dessin+chien',
      title: 'Commande',
    }),
    {
      url: `${origin}/fr/commande?utm_source=insta&utm_campaign=noel`,
      referrer: 'https://www.google.com/search',
      title: 'Commande',
    },
  )
  // The tracker sends a same-site referrer as a path: a private one is removed, not the visit.
  assert.deepEqual(send('event', { url: `${origin}/fr`, referrer: '/fr/commande/suivi/EX-1' }), {
    url: `${origin}/fr`,
    referrer: '',
  })
  assert.deepEqual(send('event', { url: `${origin}/fr`, referrer: '/en?utm_medium=mail&x=1' }), {
    url: `${origin}/fr`,
    referrer: '/en?utm_medium=mail',
  })
  assert.deepEqual(send('identify', { website: 'w' }), { website: 'w' })
  const open = beforeSend(origin, null)
  assert.deepEqual(open('event', { url: `${origin}/fr/commande/acces?x=1`, referrer: '' }), {
    url: `${origin}/fr/commande/acces`,
    referrer: '',
  })
})

void test('the tag: deferred, nonced, Do Not Track honoured, query kept for utm_*', () => {
  const scripts = analyticsScripts({
    analytics: umami,
    nonce: 'abc',
    domain: 'shop.example.test',
    privatePattern: privatePaths(orders),
  })
  assert.ok(scripts)
  const [filter, tracker] = scripts
  assert.equal(filter.nonce, 'abc')
  assert.ok(filter.dangerouslySetInnerHTML.__html.includes(BEFORE_SEND))
  assert.deepEqual(tracker, {
    defer: true,
    nonce: 'abc',
    src: `${umami.host}/script.js`,
    'data-website-id': umami.websiteId,
    'data-domains': 'shop.example.test,www.shop.example.test',
    'data-do-not-track': 'true',
    'data-before-send': BEFORE_SEND,
  })
  // data-exclude-search would drop the query, utm_* included: the filter above trims it instead.
  assert.ok(!('data-exclude-search' in tracker))
  assert.equal(
    analyticsScripts({ analytics: null, nonce: 'abc', domain: 'x.test', privatePattern: null }),
    null,
  )
})

const purchase = { locale: 'fr', amountCents: 4250, currency: 'EUR' }

void test('a purchase is an event with its amount, on a public address and no referrer', () => {
  const props = {
    website: umami.websiteId,
    url: 'https://shop.example.test/fr/commande/suivi/EX-1?paid=1',
    referrer: 'https://checkout.stripe.com/',
    title: 'Commande',
  }
  assert.deepEqual(purchaseEvent(props, purchase), {
    website: umami.websiteId,
    url: '/fr',
    referrer: '',
    title: 'Commande',
    name: PURCHASE_EVENT,
    data: { revenue: 42.5, currency: 'EUR' },
  })
  // Through the filter of the page: kept as is, nothing private left in it.
  const sent = beforeSend('https://shop.example.test', privatePaths(orders))(
    'event',
    purchaseEvent(props, purchase),
  )
  assert.deepEqual(sent, purchaseEvent(props, purchase))
  assert.ok(!JSON.stringify(sent).includes('EX-1'))
})

function fakeWindow({ tracker = true, storage = true } = {}) {
  const sent: Record<string, unknown>[] = []
  const stored = new Map<string, string>()
  return {
    sent,
    stored,
    window: {
      umami: tracker
        ? {
            track: (payload: (props: Record<string, unknown>) => Record<string, unknown>) =>
              sent.push(
                payload({ website: 'w', url: 'https://shop.example.test/x', referrer: '' }),
              ),
          }
        : undefined,
      localStorage: storage
        ? {
            getItem: (key: string) => stored.get(key) ?? null,
            setItem: (key: string, value: string) => void stored.set(key, value),
          }
        : {
            getItem: () => {
              throw new Error('blocked')
            },
            setItem: () => {
              throw new Error('blocked')
            },
          },
    },
  }
}

void test('a purchase is reported once per browser, even when the page is reloaded', () => {
  const { window, sent, stored } = fakeWindow()
  assert.equal(reportPurchase(window, 'EX-1', purchase), 'sent')
  assert.equal(reportPurchase(window, 'EX-1', purchase), 'already')
  assert.equal(sent.length, 1)
  assert.equal(sent[0]?.['name'], PURCHASE_EVENT)
  assert.deepEqual([...stored.keys()], ['purchase:EX-1'])
  assert.equal(reportPurchase(window, 'EX-2', purchase), 'sent')
  assert.equal(sent.length, 2)
})

void test('no tracker yet (or blocked): nothing sent nor remembered, the page tries again', () => {
  const { window, stored } = fakeWindow({ tracker: false })
  assert.equal(reportPurchase(window, 'EX-1', purchase), 'no-tracker')
  assert.equal(stored.size, 0)
})

void test('storage blocked (private window): the purchase is still sent', () => {
  const { window, sent } = fakeWindow({ storage: false })
  assert.equal(reportPurchase(window, 'EX-1', purchase), 'sent')
  assert.equal(sent.length, 1)
})

void test('a site without the orders module: no private order pages, its config still parses', () => {
  assert.equal(privatePaths({ identity: { locales: ['fr', 'en'] }, modules: {} }), null)
  const config = raw()
  config['modules'] = {}
  assert.equal(parseSite(config).modules.orders, undefined)
})
