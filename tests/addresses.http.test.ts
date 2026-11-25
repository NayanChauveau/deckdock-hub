import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POST } from '../src/modules/addresses/http/suggest-route'
import { POST as DETAILS } from '../src/modules/addresses/http/details-route'
import { devOrigin } from '../src/core/site'
void test('address endpoint rejects cross-origin, oversized and malformed requests without upstream calls', async () => {
  const origin = process.env['APP_URL'] ?? devOrigin
  const previous = process.env['APP_URL']
  process.env['APP_URL'] = origin
  try {
    const request = (body: string, from = origin) =>
      new Request(`${origin}/api/addresses`, { method: 'POST', headers: { Origin: from }, body })
    assert.equal((await POST(request('{}', 'https://other.example'))).status, 403)
    assert.equal((await POST(request('x'.repeat(2049)))).status, 413)
    assert.equal((await POST(request('{'))).status, 400)
    const body = (extra: string) =>
      `{"query":"rue",${extra},"locale":"fr","session":"3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23"}`
    assert.equal((await POST(request(body('"country":"XX"')))).status, 400)
    assert.equal((await POST(request(body('"country":"fr"')))).status, 400)
    const response = await POST(
      request(
        '{"query":"ab","country":"FR","locale":"fr","session":"3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23"}',
      ),
    )
    assert.equal(response.status, 200)
    assert.match(response.headers.get('Cache-Control') ?? '', /no-store/)
    assert.deepEqual(await response.json(), { suggestions: [] })
    const details = (payload: string, from = origin) =>
      DETAILS(
        new Request(`${origin}/api/addresses/details`, {
          method: 'POST',
          headers: { Origin: from },
          body: payload,
        }),
      )
    const ok = '"locale":"fr","session":"3f2b8c1e-5d4a-4b7e-9a10-2c6d8e0f1a23"'
    assert.equal((await details('{}', 'https://other.example')).status, 403)
    assert.equal((await details('x'.repeat(2049))).status, 413)
    assert.equal((await details('{')).status, 400)
    assert.equal((await details(`{"id":"p","country":"XX",${ok}}`)).status, 400)
    assert.equal((await details(`{"id":"p","country":"fr",${ok}}`)).status, 400)
  } finally {
    if (previous === undefined) delete process.env['APP_URL']
    else process.env['APP_URL'] = previous
  }
})
