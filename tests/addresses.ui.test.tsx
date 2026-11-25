import { present } from './support/present'
import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react/pure'
import { useState } from 'react'
import { AddressField } from '../src/modules/addresses/ui/AddressField'
import { addressMessages } from '../src/modules/addresses/messages'

const originalFetch = globalThis.fetch
const json = (value: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(value), { status }))
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
  window.history.replaceState(null, '', '/')
})

/** The address field as a form uses it: a suggestion fills the postal code and the city. */
function AddressForm({ locale, country }: { locale: 'fr' | 'en'; country: string }) {
  const [address, setAddress] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [city, setCity] = useState('')
  return (
    <form>
      <AddressField
        id="address"
        name="address"
        inputRef={null}
        value={address}
        onChange={setAddress}
        onBlur={() => undefined}
        country={country}
        locale={locale}
        disabled={false}
        error=""
        onSelect={(details) => {
          setAddress(details.address)
          // Empty parts are unknown: what the customer typed stays.
          if (details.postalCode) setPostalCode(details.postalCode)
          if (details.city) setCity(details.city)
        }}
      />
      <input
        name="postalCode"
        value={postalCode}
        onChange={(event) => {
          setPostalCode(event.target.value)
        }}
      />
      <input
        name="city"
        value={city}
        onChange={(event) => {
          setCity(event.target.value)
        }}
      />
    </form>
  )
}

const sug = { id: 'p1', label: '8 rue Exemple, 75001 Paris' }
const detail = { address: '8 rue Exemple', postalCode: '75001', city: 'Paris', country: 'FR' }
void test('address suggestions debounce typing; picking fetches details with the same session and fills the fields', async () => {
  const bodies: Record<string, unknown>[] = []
  const details: Record<string, unknown>[] = []
  globalThis.fetch = (url, init) => {
    const body = JSON.parse(init?.body as string) as Record<string, unknown>
    if (url === '/api/addresses') {
      bodies.push(body)
      return json({ suggestions: [sug] })
    }
    details.push(body)
    return json({ address: detail })
  }
  const { container } = render(<AddressForm locale="fr" country="FR" />)
  const address = present(container.querySelector<HTMLInputElement>('input[name="address"]'))
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: '8 ru' } })
  fireEvent.change(address, { target: { value: '8 rue' } })
  const option = await screen.findByRole('option', { name: sug.label })
  assert.equal(bodies.length, 1)
  assert.equal(screen.getByText('Powered by Google').textContent, 'Powered by Google')
  fireEvent.click(option)
  await waitFor(() => {
    assert.equal(
      present(container.querySelector<HTMLInputElement>('input[name="postalCode"]')).value,
      '75001',
    )
  })
  assert.equal(address.value, '8 rue Exemple')
  assert.equal(
    present(container.querySelector<HTMLInputElement>('input[name="city"]')).value,
    'Paris',
  )
  assert.deepEqual(details, [
    { id: 'p1', country: 'FR', locale: 'fr', session: bodies[0]?.['session'] },
  ])
  // A new session starts after the pick.
  fireEvent.change(address, { target: { value: '9 rue modifiée' } })
  await waitFor(() => {
    assert.equal(bodies.length, 2)
  })
  assert.notEqual(bodies[1]?.['session'], bodies[0]?.['session'])
  assert.equal(address.value, '9 rue modifiée')
})
void test('typed address is kept without a pick: blur and Escape clear nothing', async () => {
  globalThis.fetch = () => json({ suggestions: [sug] })
  const { container } = render(<AddressForm locale="fr" country="FR" />)
  const address = present(container.querySelector<HTMLInputElement>('input[name="address"]'))
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: '10 rue' } })
  await screen.findByRole('option')
  fireEvent.keyDown(address, { key: 'Escape' })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  assert.equal(address.value, '10 rue')
  fireEvent.blur(address)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  assert.equal(address.value, '10 rue')
  assert.equal(present(container.querySelector<HTMLInputElement>('input[name="city"]')).value, '')
})
void test('a place without house number keeps the typed street and fills the rest', async () => {
  globalThis.fetch = (url) =>
    url === '/api/addresses'
      ? json({ suggestions: [{ id: 'r1', label: 'Rue de la Paix, Paris' }] })
      : json({ address: { address: '', postalCode: '75002', city: 'Paris', country: 'FR' } })
  const { container } = render(<AddressForm locale="fr" country="FR" />)
  const address = present(container.querySelector<HTMLInputElement>('input[name="address"]'))
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: '12 rue de la Paix' } })
  fireEvent.click(await screen.findByRole('option', { name: 'Rue de la Paix, Paris' }))
  await waitFor(() => {
    assert.equal(
      present(container.querySelector<HTMLInputElement>('input[name="postalCode"]')).value,
      '75002',
    )
  })
  assert.equal(address.value, '12 rue de la Paix')
  assert.equal(
    present(container.querySelector<HTMLInputElement>('input[name="city"]')).value,
    'Paris',
  )
})
void test('details without postal code or city keep the typed ones', async () => {
  globalThis.fetch = (url) =>
    url === '/api/addresses'
      ? json({ suggestions: [sug] })
      : json({ address: { address: '8 rue Exemple', postalCode: '', city: '', country: 'FR' } })
  const { container } = render(<AddressForm locale="fr" country="FR" />)
  const postalCode = present(container.querySelector<HTMLInputElement>('input[name="postalCode"]'))
  const city = present(container.querySelector<HTMLInputElement>('input[name="city"]'))
  fireEvent.change(postalCode, { target: { value: '75001' } })
  fireEvent.change(city, { target: { value: 'Paris' } })
  const address = present(container.querySelector<HTMLInputElement>('input[name="address"]'))
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: '8 rue' } })
  fireEvent.click(await screen.findByRole('option'))
  await waitFor(() => {
    assert.equal(address.value, '8 rue Exemple')
  })
  assert.equal(postalCode.value, '75001')
  assert.equal(city.value, 'Paris')
})
void test('failed details keep what the customer typed', async () => {
  globalThis.fetch = (url) =>
    url === '/api/addresses' ? json({ suggestions: [sug] }) : json({ error: 'unavailable' }, 503)
  const { container } = render(<AddressForm locale="fr" country="FR" />)
  const address = present(container.querySelector<HTMLInputElement>('input[name="address"]'))
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: '8 rue' } })
  fireEvent.click(await screen.findByRole('option'))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  assert.equal(address.value, '8 rue')
})
void test('address provider failure leaves manual address entry available', async () => {
  globalThis.fetch = (url) => (url === '/api/addresses' ? json({}, 503) : json({}))
  const { container } = render(<AddressForm locale="en" country="BE" />)
  const address = present(container.querySelector<HTMLInputElement>('input[name="address"]'))
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: 'Rue manuelle 8' } })
  await screen.findByText(addressMessages.en.addressSearch.unavailable)
  assert.equal(address.value, 'Rue manuelle 8')
  assert.equal(address.disabled, false)
  assert.equal(screen.queryByRole('option'), null)
})
void test('late address response is ignored after the query changes', async () => {
  let finish!: (response: Response) => void
  let requests = 0
  globalThis.fetch = (url) => {
    if (url !== '/api/addresses') return json({})
    requests++
    if (requests === 1)
      return new Promise((resolve) => {
        finish = resolve
      })
    return json({ suggestions: [] })
  }
  const { container } = render(<AddressForm locale="fr" country="FR" />)
  const address = present(container.querySelector<HTMLInputElement>('input[name="address"]'))
  fireEvent.focus(address)
  fireEvent.change(address, { target: { value: 'ancienne rue' } })
  await waitFor(() => {
    assert.equal(requests, 1)
  })
  fireEvent.change(address, { target: { value: 'nouvelle rue' } })
  await act(async () => {
    finish(
      Response.json({
        suggestions: [
          {
            id: 'old',
            label: 'Ancienne suggestion',
          },
        ],
      }),
    )
    await Promise.resolve()
  })
  assert.equal(screen.queryByRole('option'), null)
  assert.equal(address.value, 'nouvelle rue')
  await waitFor(() => {
    assert.equal(requests, 2)
  })
})

void test('address keeps typed spaces and text when suggestions close and reopen', async () => {
  let searches = 0
  globalThis.fetch = (url) => {
    if (url !== '/api/addresses') return json({})
    searches++
    return json({
      suggestions: [
        {
          id: 'ign:204',
          label: '204 Boulevard Exemple, 75001 Paris',
        },
      ],
    })
  }
  const { container } = render(<AddressForm locale="fr" country="FR" />)
  const address = present(container.querySelector<HTMLInputElement>('input[name="address"]'))
  fireEvent.focus(address)
  fireEvent.input(address, {
    target: { value: '204 boulevard' },
    inputType: 'insertText',
    data: 'd',
  })
  await screen.findByRole('option')
  fireEvent.input(address, {
    target: { value: '204 boulevard ' },
    inputType: 'insertText',
    data: ' ',
  })
  await waitFor(() => {
    assert.equal(screen.queryByRole('option'), null)
  })
  // Closing the popup completes asynchronously; it must not reset the free text.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  assert.equal(address.value, '204 boulevard ')
  await waitFor(() => {
    assert.equal(searches, 2)
  })
  await screen.findByRole('option')
  fireEvent.input(address, {
    target: { value: '204 boulevard Victor' },
    inputType: 'insertText',
    data: 'Victor',
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  assert.equal(address.value, '204 boulevard Victor')
  fireEvent.keyDown(address, { key: 'Escape' })
  fireEvent.blur(address)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
  })
  assert.equal(address.value, '204 boulevard Victor')
  fireEvent.input(address, { target: { value: '' }, inputType: 'deleteContentBackward' })
  assert.equal(address.value, '')
})
