import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Writable } from 'node:stream'
import { createLogger } from '../src/core/logger'
import { reportRequestError } from '../src/core/http/request-error'
import { site } from '../src/core/site'

interface Entry {
  level: string
  service: string
  msg: string
  time: string
  orderId?: string
  path?: string
  routePath?: string
  digest?: string
  err: { stack: string }
}
const parse = (line: string | undefined) => JSON.parse(line ?? '{}') as Entry

function capture() {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(...String(chunk).split('\n').filter(Boolean))
      done()
    },
  })
  return { lines, log: createLogger(stream) }
}

void test('logs one JSON line per event, with level name, service and the full stack', () => {
  const { lines, log } = capture()
  log.error({ err: new Error('boom'), orderId: 'o1' }, 'commerce_request_failed')
  assert.equal(lines.length, 1)
  const entry = parse(lines[0])
  assert.equal(entry.level, 'error')
  assert.equal(entry.service, site.app.logService)
  assert.equal(entry.msg, 'commerce_request_failed')
  assert.equal(entry.orderId, 'o1')
  assert.match(entry.err.stack, /Error: boom/)
  assert.match(entry.err.stack, /logger\.test\.ts/)
  assert.match(entry.time, /^\d{4}-\d{2}-\d{2}T/)
})

void test('reports an unhandled Next.js request error with its route, without the query string', () => {
  const { lines, log } = capture()
  const error = Object.assign(new Error('render failed'), { digest: '42' })
  reportRequestError(
    log,
    error,
    { path: '/fr/admin?token=secret', method: 'GET', headers: {} },
    {
      routerKind: 'App Router',
      routePath: '/[locale]/admin',
      routeType: 'render',
    },
  )
  const entry = parse(lines[0])
  assert.equal(entry.level, 'error')
  assert.equal(entry.msg, 'request_failed')
  assert.equal(entry.path, '/fr/admin')
  assert.equal(entry.routePath, '/[locale]/admin')
  assert.equal(entry.digest, '42')
  assert.match(entry.err.stack, /render failed/)
  assert.doesNotMatch(lines[0] ?? '', /token=secret/)
})
