import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AddressSearchUnavailable,
  InvalidAddressQuery,
  SuggestAddresses,
} from '../src/modules/addresses/application/suggest-addresses'
import { PacedAddressProvider } from '../src/modules/addresses/adapters/paced-provider'
import { GooglePlacesAddressProvider } from '../src/modules/addresses/adapters/google-places-provider'

const session = '3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23'
const suggestion = { id: 'p1', label: '8 rue Exemple, 75001 Paris' }
const noDetails = () => Promise.resolve(null)
const component = (type: string, longText: string, shortText = longText) => ({
  types: [type],
  longText,
  shortText,
})
const place = (components: unknown[]) => Response.json({ addressComponents: components })

void test('address use case ignores short input, validates and caps results', async () => {
  const queries: string[] = []
  const useCase = new SuggestAddresses({
    search: (input) => {
      queries.push(input.query)
      return Promise.resolve(
        Array.from({ length: 8 }, (_, n) => ({ ...suggestion, id: `p${String(n)}` })).concat([
          { id: '', label: 'x' },
        ]),
      )
    },
    details: noDetails,
  })
  const base = { country: 'FR', locale: 'fr', session } as const
  assert.deepEqual(await useCase.execute({ ...base, query: 'ab' }), [])
  assert.equal(queries.length, 0)
  assert.equal((await useCase.execute({ ...base, query: '  8   rue Exemple ' })).length, 5)
  assert.deepEqual(queries, ['8 rue Exemple'])
  for (const bad of [
    { query: 'a'.repeat(201) },
    { query: 'rue', country: 'XX' },
    { query: 'rue', country: 'fr' },
    { query: 'rue', session: 'nope' },
  ])
    await assert.rejects(useCase.execute({ ...base, ...bad }), InvalidAddressQuery)
})
void test('details never return an address from another country', async () => {
  const useCase = new SuggestAddresses({
    search: () => Promise.resolve([]),
    details: () =>
      Promise.resolve({ address: '1 rue', postalCode: '1000', city: 'Bruxelles', country: 'BE' }),
  })
  assert.equal(await useCase.details({ id: 'p', country: 'FR', locale: 'fr', session }), null)
  await assert.rejects(
    useCase.details({ id: 'p', country: 'XX', locale: 'fr', session }),
    InvalidAddressQuery,
  )
})
void test('google autocomplete is restricted to the country, with session token and key in a header', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const provider = new GooglePlacesAddressProvider('secret-key', (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : String(input), init: init ?? {} })
    return Promise.resolve(
      Response.json({
        suggestions: [
          { placePrediction: { placeId: 'p1', text: { text: suggestion.label } } },
          { queryPrediction: {} },
        ],
      }),
    )
  })
  assert.deepEqual(
    await provider.search({ query: '8 rue', country: 'CH', locale: 'en', session }),
    [suggestion],
  )
  const call = calls[0]
  assert.ok(call)
  assert.equal(call.url, 'https://places.googleapis.com/v1/places:autocomplete')
  assert.ok(!call.url.includes('secret-key'))
  assert.equal((call.init.headers as Record<string, string>)['X-Goog-Api-Key'], 'secret-key')
  assert.equal(call.init.cache, 'no-store')
  assert.deepEqual(JSON.parse(call.init.body as string), {
    input: '8 rue',
    includedRegionCodes: ['CH'],
    includedPrimaryTypes: ['street_address', 'premise', 'subpremise'],
    languageCode: 'en',
    sessionToken: session,
  })
})
void test('google details map the address components and reject other countries', async () => {
  const urls: string[] = []
  const answer = (components: unknown[]) =>
    new GooglePlacesAddressProvider('k', (input, init) => {
      urls.push(input instanceof Request ? input.url : String(input))
      assert.equal(
        (init?.headers as Record<string, string>)['X-Goog-FieldMask'],
        'addressComponents',
      )
      return Promise.resolve(place(components))
    })
  const input = { id: 'p1', country: 'FR', locale: 'fr', session } as const
  const full = [
    component('street_number', '8'),
    component('route', 'Rue Exemple'),
    component('postal_code', '75001'),
    component('locality', 'Paris'),
    component('country', 'France', 'FR'),
  ]
  assert.deepEqual(await answer(full).details(input), {
    address: '8 Rue Exemple',
    postalCode: '75001',
    city: 'Paris',
    country: 'FR',
  })
  const url = new URL(urls[0] ?? '')
  assert.equal(url.pathname, '/v1/places/p1')
  assert.equal(url.searchParams.get('sessionToken'), session)
  assert.ok(!url.search.includes('key'))
  const town = full.map((c) =>
    c.types[0] === 'locality' ? component('postal_town', 'Londres') : c,
  )
  assert.equal((await answer(town).details(input))?.city, 'Londres')
  const badPostal = full.map((c) =>
    c.types[0] === 'postal_code' ? component('postal_code', '!!bad!!') : c,
  )
  assert.equal((await answer(badPostal).details(input))?.postalCode, '')
  const foreign = full.map((c) =>
    c.types[0] === 'country' ? component('country', 'Belgique', 'BE') : c,
  )
  assert.equal(await answer(foreign).details(input), null)
  // A street with no house number: the address stays empty so the typed line is kept.
  const routeOnly = full.filter((c) => c.types[0] !== 'street_number')
  assert.deepEqual(await answer(routeOnly).details(input), {
    address: '',
    postalCode: '75001',
    city: 'Paris',
    country: 'FR',
  })
})
void test('details with only some parts are returned; with none, nothing', async () => {
  const partsOf = (details: { address: string; postalCode: string; city: string }) =>
    new SuggestAddresses({
      search: () => Promise.resolve([]),
      details: () => Promise.resolve({ ...details, country: 'FR' }),
    }).details({ id: 'p', country: 'FR', locale: 'fr', session })
  assert.deepEqual(await partsOf({ address: '', postalCode: '', city: 'Paris' }), {
    address: '',
    postalCode: '',
    city: 'Paris',
    country: 'FR',
  })
  assert.equal(await partsOf({ address: ' ', postalCode: '', city: '' }), null)
})
void test('google provider is unavailable without key, on HTTP errors and on timeouts', async () => {
  const q = { query: 'rue', country: 'FR', locale: 'fr', session } as const
  const d = { id: 'p', country: 'FR', locale: 'fr', session } as const
  const noKey = new GooglePlacesAddressProvider(undefined, () => {
    throw new Error('must not be called')
  })
  await assert.rejects(noKey.search(q), AddressSearchUnavailable)
  await assert.rejects(noKey.details(d), AddressSearchUnavailable)
  for (const failing of [
    () => Promise.resolve(new Response('{}', { status: 403 })),
    () => Promise.resolve(new Response('{}', { status: 500 })),
    () => Promise.reject(new DOMException('timeout', 'TimeoutError')),
    () => Promise.resolve(Response.json({ suggestions: 'bad', addressComponents: 3 })),
  ]) {
    const provider = new GooglePlacesAddressProvider('k', failing)
    await assert.rejects(provider.search(q), AddressSearchUnavailable)
    await assert.rejects(provider.details(d), AddressSearchUnavailable)
  }
})
void test('provider cache returns isolated values and skips the budget', async () => {
  let now = 10_000
  let calls = 0
  const provider = new PacedAddressProvider(
    {
      search: () => {
        calls++
        return Promise.resolve([suggestion])
      },
      details: noDetails,
    },
    () => now,
    { perMinute: 60, burst: 1 },
  )
  const query = { query: 'rue exemple', country: 'BE', locale: 'fr', session } as const
  const first = await provider.search(query)
  first.splice(0)
  // Cached: the budget (one call) is not spent again.
  assert.equal((await provider.search(query)).length, 1)
  assert.equal(calls, 1)
  await assert.rejects(provider.search({ ...query, query: 'autre rue' }), AddressSearchUnavailable)
  now += 1000
  await provider.search({ ...query, query: 'autre rue' })
  assert.equal(calls, 2)
  now += 60_000
  await provider.search(query)
  assert.equal(calls, 3)
})
void test('one process-wide budget covers searches and details of every country', async () => {
  let now = 0
  const upstream: string[] = []
  const provider = new PacedAddressProvider(
    {
      search: (input) => {
        upstream.push(`search ${input.country}`)
        return Promise.resolve([suggestion])
      },
      details: (input) => {
        upstream.push(`details ${input.country}`)
        return Promise.resolve(null)
      },
    },
    () => now,
    { perMinute: 6, burst: 3 },
  )
  const q = (query: string, country: string) => ({ query, country, locale: 'fr', session }) as const
  const d = (country: string) => ({ id: 'p', country, locale: 'fr', session }) as const
  await provider.search(q('rue un', 'FR'))
  await provider.details(d('FR'))
  await provider.search(q('rue deux', 'BE'))
  // The burst is spent: neither another country nor a details call gets through.
  await assert.rejects(provider.search(q('rue trois', 'CH')), AddressSearchUnavailable)
  await assert.rejects(provider.search(q('rue quatre', 'DE')), AddressSearchUnavailable)
  await assert.rejects(provider.details(d('IT')), AddressSearchUnavailable)
  assert.equal(upstream.length, 3)
  // Six calls a minute: one more every ten seconds, whatever the country or the call.
  now += 10_000
  await provider.details(d('ES'))
  await assert.rejects(provider.search(q('rue cinq', 'PT')), AddressSearchUnavailable)
  now += 10_000
  await provider.search(q('rue cinq', 'PT'))
  assert.deepEqual(upstream, ['search FR', 'details FR', 'search BE', 'details ES', 'search PT'])
  // A long pause refills only up to the burst.
  now += 3_600_000
  for (const country of ['NL', 'LU', 'AT']) await provider.details(d(country))
  await assert.rejects(provider.details(d('PL')), AddressSearchUnavailable)
})
