import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react/pure'
import { OrderStatusView } from '../src/modules/orders/ui/OrderStatus'
import { OrderAccessView } from '../src/modules/orders/ui/OrderAccess'
import { orderMessages } from '../src/modules/orders/messages'
import { OrderLines } from '../src/modules/orders/admin/OrderLines'
import { OrderAmount } from '../src/modules/orders/admin/OrderAmount'
import { OrderCountry } from '../src/modules/orders/admin/OrderCountry'
import { adminAmount } from '../src/modules/orders/admin/money'
import type { JSONFieldServerProps, NumberFieldServerProps, TextFieldServerProps } from 'payload'

const originalFetch = globalThis.fetch
const json = (value: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(value), { status }))
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  window.history.replaceState(null, '', '/')
})

void test('pending payment simulation refreshes only after server confirmation; errors remain visible', async () => {
  let refreshed = 0
  let succeeds = false
  globalThis.fetch = (_url, init) => {
    assert.deepEqual(JSON.parse(typeof init?.body === 'string' ? init.body : '') as unknown, {
      reference: 'EX-test',
    })
    return json({}, succeeds ? 200 : 503)
  }
  render(
    <OrderStatusView
      locale="en"
      reference="EX-test"
      pending
      simulated
      refresh={() => {
        refreshed++
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button'))
  assert.equal((await screen.findByRole('alert')).textContent, orderMessages.en.error)
  assert.equal(refreshed, 0)
  succeeds = true
  fireEvent.click(screen.getByRole('button'))
  await waitFor(() => {
    assert.equal(refreshed, 1)
  })
})

void test('paid orders offer no local simulation or pending polling message', () => {
  render(
    <OrderStatusView
      locale="fr"
      reference="EX-test"
      pending={false}
      simulated
      refresh={() => assert.fail('No refresh for paid orders')}
    />,
  )
  assert.equal(screen.queryByRole('button'), null)
  assert.equal(screen.queryByRole('status'), null)
})

void test('private access removes fragment before exchanging credentials and follows the server URL', async () => {
  window.history.replaceState(null, '', '/en/commande/acces#reference=EX-test&token=private-token')
  let destination = ''
  globalThis.fetch = (url, init) => {
    assert.equal(window.location.hash, '')
    assert.equal(url, '/api/commerce/access')
    assert.deepEqual(JSON.parse(typeof init?.body === 'string' ? init.body : '') as unknown, {
      reference: 'EX-test',
      token: 'private-token',
      locale: 'en',
    })
    return json({ url: '/en/commande/suivi/EX-test' })
  }
  render(
    <OrderAccessView
      locale="en"
      replace={(url) => {
        destination = url
      }}
    />,
  )
  await waitFor(() => {
    assert.equal(destination, '/en/commande/suivi/EX-test')
  })
})

void test('invalid private link shows a useful error without navigating', async () => {
  globalThis.fetch = () => json({}, 403)
  render(<OrderAccessView locale="fr" replace={() => assert.fail('Invalid credentials')} />)
  await waitFor(() => {
    assert.match(screen.getByRole('status').textContent, /Lien invalide/)
  })
})

void test('pending polling stops after 24 refreshes and is cancelled on unmount', (context) => {
  context.mock.timers.enable({ apis: ['setInterval'] })
  let refreshed = 0
  const refresh = () => {
    refreshed++
  }
  const view = render(
    <OrderStatusView locale="en" reference="EX-test" pending simulated={false} refresh={refresh} />,
  )
  act(() => {
    context.mock.timers.tick(125000)
  })
  assert.equal(refreshed, 24)
  act(() => {
    context.mock.timers.tick(120000)
  })
  assert.equal(refreshed, 24)
  view.unmount()
  render(
    <OrderStatusView locale="en" reference="EX-test" pending simulated={false} refresh={refresh} />,
  ).unmount()
  act(() => {
    context.mock.timers.tick(10000)
  })
  assert.equal(refreshed, 24)
})

void test('retry requests payment for the same order and handles an already received payment', async () => {
  let refreshed = 0
  globalThis.fetch = (url, init) => {
    assert.equal(url, '/api/commerce/retry')
    assert.equal(init?.method, 'POST')
    assert.equal(init.body, JSON.stringify({ reference: 'EX-test' }))
    return json({ url: null })
  }
  render(
    <OrderStatusView
      locale="fr"
      reference="EX-test"
      pending={false}
      simulated={false}
      canRetry
      refresh={() => {
        refreshed++
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: orderMessages.fr.retryPayment }))
  await screen.findByText(orderMessages.fr.paymentProcessing)
  assert.equal(screen.queryByRole('button'), null)
  assert.equal(refreshed, 1)
})

void test('the administration reads order amounts in euros; they stay stored in cents', () => {
  assert.equal(adminAmount(21400).replace(/\s/g, ' '), '214,00 €')
  assert.equal(adminAmount(1250, 'EUR').replace(/\s/g, ' '), '12,50 €')
  assert.equal(adminAmount(null), '—')
  const lines = [
    { label: 'Dessin', unitCents: 15000, quantity: 1 },
    { label: 'Tirage', unitCents: 3000, quantity: 2 },
  ]
  const props = {
    value: lines,
    siblingData: { currency: 'EUR' },
  } as unknown as JSONFieldServerProps
  render(<OrderLines {...props} />)
  const rows = screen.getAllByRole('row').map((row) => row.textContent.replace(/\s/g, ' '))
  assert.deepEqual(rows, [
    'ArticleQuantitéPrix unitaireTotal',
    'Dessin1150,00 €150,00 €',
    'Tirage230,00 €60,00 €',
  ])
  cleanup()
  const total = {
    field: { name: 'totalCents', label: 'Total' },
    value: 21400,
    siblingData: { currency: 'EUR' },
  } as unknown as NumberFieldServerProps
  render(<OrderAmount {...total} />)
  assert.ok(screen.getByText('Total'))
  assert.ok(screen.getByText((text) => text.replace(/\s/g, ' ') === '214,00 €'))
})

void test('the admin shows the delivery country by its French name', () => {
  const props = (value: string) =>
    ({ field: { name: 'country', label: 'Pays' }, value }) as unknown as TextFieldServerProps
  render(<OrderCountry {...props('FR')} />)
  assert.ok(screen.getByText('Pays'))
  assert.ok(screen.getByText('France'))
  cleanup()
  render(<OrderCountry {...props('BE')} />)
  assert.ok(screen.getByText('Belgique'))
})
