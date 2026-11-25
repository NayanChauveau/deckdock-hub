import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ordersSettings } from '../src/modules/orders/settings'
import { OrderReference, orderReferencePattern } from '../src/modules/orders/domain/value-objects'
import { isOrderReference, orderCookieName } from '../src/modules/orders/reference'

const prefix = ordersSettings.referencePrefix

void test('an order reference has the generic shape, whatever the site prefix', () => {
  assert.equal(OrderReference.of('AB-0123456789ABCDEF').value, 'AB-0123456789ABCDEF')
  assert.equal(OrderReference.of(`${prefix}-0123456789ABCDEF`).value, `${prefix}-0123456789ABCDEF`)
  for (const bad of ['0123456789ABCDEF', 'A-0123456789ABCDEF', 'AB-0123', 'ab-0123456789ABCDEF'])
    assert.throws(() => OrderReference.of(bad), bad)
})

void test('public routes only accept the references of this site', () => {
  assert.ok(orderReferencePattern(prefix).test(`${prefix}-0123456789ABCDEF`))
  assert.ok(isOrderReference(`${prefix}-0123456789ABCDEF`))
  const other = prefix === 'ZZ' ? 'YY' : 'ZZ'
  assert.equal(isOrderReference(`${other}-0123456789ABCDEF`), false)
  assert.equal(isOrderReference(`${prefix}-0123456789abcdef`), false)
})

void test('the private access cookie is named from the configured prefix', () => {
  assert.equal(
    orderCookieName(`${prefix}-0123456789ABCDEF`),
    `${ordersSettings.accessCookiePrefix}${prefix}-0123456789ABCDEF`,
  )
})
