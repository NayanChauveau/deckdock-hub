import assert from 'node:assert/strict'
import { test } from 'node:test'
import { customerCommentValue } from '../src/modules/orders/domain/value-objects'
import { OrderError } from '../src/modules/orders/domain/errors'

void test('customer comments are optional bounded multiline text, never arbitrary input', () => {
  assert.equal(customerCommentValue(undefined), '')
  assert.equal(customerCommentValue('   '), '')
  assert.equal(
    customerCommentValue('  Garder le visage.\r\nSans fond.  '),
    'Garder le visage.\nSans fond.',
  )
  assert.equal(customerCommentValue('a'.repeat(2000)).length, 2000)
  for (const value of ['a'.repeat(2001), 'bad\u0000text', 'bad\u001btext', 123, {}])
    assert.throws(() => customerCommentValue(value), OrderError)
})
