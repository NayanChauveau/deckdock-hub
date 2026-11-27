import assert from 'node:assert/strict'
import { test } from 'node:test'
import { visitorCookies, visitorHeaders } from '../src/core/http/visitor-cookies'

void test('the visitor cookies leave out the administration’s, and only those', () => {
  // The administration's cookies (`payload-token`, `payload-totp`) are left out: the accounts
  // strategy then resolves the visitor, as the sign-in page's visitorSession does.
  assert.equal(
    visitorCookies(
      'payload-token=a; customer.session_token=b; payload-totp=c; theme=dark',
      'payload',
    ),
    'customer.session_token=b; theme=dark',
  )
  assert.equal(visitorCookies('customer.session_token=b', 'payload'), 'customer.session_token=b')
  assert.equal(visitorCookies('payload-token=a', 'payload'), '')
  // Another prefix, only its own cookies.
  assert.equal(visitorCookies('site-token=a; payload-token=b', 'site'), 'payload-token=b')
})

void test('the visitor headers keep everything but the administration’s cookies', () => {
  const original = new Headers({
    cookie: 'payload-token=a; customer.session_token=b',
    origin: 'https://hub.example',
    'sec-fetch-site': 'same-origin',
    authorization: 'users API-Key x',
  })
  const visitor = visitorHeaders(original, 'payload')
  assert.equal(visitor.get('cookie'), 'customer.session_token=b')
  assert.equal(visitor.get('origin'), 'https://hub.example')
  assert.equal(visitor.get('sec-fetch-site'), 'same-origin')
  // An administrator's API key is not a visitor's credential either.
  assert.equal(visitor.get('authorization'), null)
  // The request's own headers are not changed.
  assert.equal(original.get('cookie'), 'payload-token=a; customer.session_token=b')
  // Only the administration's cookies: no cookie at all.
  assert.equal(
    visitorHeaders(new Headers({ cookie: 'payload-token=a' }), 'payload').has('cookie'),
    false,
  )
})
