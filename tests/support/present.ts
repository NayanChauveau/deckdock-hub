import assert from 'node:assert/strict'
/** A missing fixture should fail here, rather than hide an unchecked non-null assertion. */
export function present<T>(value: T | null | undefined): T {
  assert.ok(value !== null && value !== undefined, 'Expected test value to be present')
  return value
}
