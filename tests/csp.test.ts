import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { Writable } from 'node:stream'
import { NextRequest } from 'next/server'
import {
  CSP_REPORT_PATH,
  MONACO_CDN,
  contentSecurityPolicy,
  createCspReportHandler,
  summarizeCspReports,
} from '../src/core/http/csp'
import { createLogger } from '../src/core/logger'
import { proxy } from '../src/proxy'

const directive = (policy: string, name: string) =>
  policy
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `)) ?? ''

void test('public pages: scripts only through the nonce, nothing from outside', () => {
  const policy = contentSecurityPolicy({ nonce: 'abc', admin: false, dev: false })
  assert.equal(directive(policy, 'script-src'), "script-src 'self' 'nonce-abc' 'strict-dynamic'")
  assert.equal(directive(policy, 'default-src'), "default-src 'self'")
  assert.equal(directive(policy, 'object-src'), "object-src 'none'")
  assert.equal(directive(policy, 'base-uri'), "base-uri 'self'")
  assert.equal(directive(policy, 'form-action'), "form-action 'self'")
  assert.equal(directive(policy, 'frame-ancestors'), "frame-ancestors 'self'")
  assert.equal(directive(policy, 'connect-src'), "connect-src 'self'")
  assert.equal(directive(policy, 'report-uri'), `report-uri ${CSP_REPORT_PATH}`)
  assert.equal(directive(policy, 'report-to'), 'report-to csp')
  assert.ok(!policy.includes('unsafe-eval'))
  assert.ok(!directive(policy, 'script-src').includes('unsafe-inline'))
  assert.ok(!policy.includes('jsdelivr'))
})

void test('administration: the same, plus the pinned Monaco editor of the JSON fields', () => {
  const policy = contentSecurityPolicy({ nonce: 'abc', admin: true, dev: false })
  assert.equal(directive(policy, 'script-src'), `script-src 'self' 'nonce-abc' ${MONACO_CDN}`)
  assert.ok(directive(policy, 'style-src').includes(MONACO_CDN))
  assert.ok(directive(policy, 'font-src').includes(MONACO_CDN))
  assert.ok(!policy.includes('unsafe-eval'))
  assert.ok(!directive(policy, 'script-src').includes('unsafe-inline'))
})

void test('Monaco is allowed at the exact version Payload loads', () => {
  const dir = 'node_modules/@payloadcms/ui/dist/exports/client'
  const loaded = new Set<string>()
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js')))
    for (const match of readFileSync(join(dir, file), 'utf8').matchAll(
      /https:\/\/cdn\.jsdelivr\.net\/npm\/monaco-editor@[0-9.]+\/min\/vs/g,
    ))
      loaded.add(`${match[0]}/`)
  assert.deepEqual([...loaded], [MONACO_CDN])
})

void test('development adds eval for React debugging, never in production', () => {
  for (const admin of [false, true]) {
    assert.ok(contentSecurityPolicy({ nonce: 'a', admin, dev: true }).includes("'unsafe-eval'"))
    assert.ok(!contentSecurityPolicy({ nonce: 'a', admin, dev: false }).includes("'unsafe-eval'"))
  }
})

void test('the proxy sends a fresh nonce to Next.js and the same policy to the browser', () => {
  const page = (path: string) => proxy(new NextRequest(`http://localhost${path}`))
  const first = page('/fr')
  const second = page('/fr')
  const sent = first.headers.get('content-security-policy') ?? ''
  assert.equal(first.headers.get('x-middleware-request-content-security-policy'), sent)
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(sent)?.[1] ?? ''
  assert.ok(nonce.length >= 22, 'At least 128 random bits')
  assert.notEqual(second.headers.get('content-security-policy'), sent)
  assert.ok(!sent.includes('jsdelivr'))
  assert.ok(
    (page('/admin/collections/orders').headers.get('content-security-policy') ?? '').includes(
      MONACO_CDN,
    ),
  )
  assert.equal(first.headers.get('reporting-endpoints'), `csp="${CSP_REPORT_PATH}"`)
})

void test('reports, both formats: directive, blocked origin and page, tokens and queries removed', () => {
  const legacy = JSON.stringify({
    'csp-report': {
      'document-uri':
        'https://shop.example.test/admin/reset/0123456789abcdef0123456789abcdef01234567?x=1',
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.example/x.js?token=secret',
    },
  })
  assert.deepEqual(summarizeCspReports(legacy), [
    {
      directive: 'script-src-elem',
      blocked: 'https://evil.example',
      page: '/admin/reset/REDACTED',
    },
  ])
  const modern = JSON.stringify([
    {
      type: 'csp-violation',
      body: {
        documentURL: 'https://shop.example.test/fr/commande',
        effectiveDirective: 'script-src-elem',
        blockedURL: 'inline',
      },
    },
    { type: 'deprecation', body: {} },
  ])
  assert.deepEqual(summarizeCspReports(modern), [
    { directive: 'script-src-elem', blocked: 'inline', page: '/fr/commande' },
  ])
  const tracking = JSON.stringify({
    'csp-report': {
      'document-uri': 'https://shop.example.test/fr/commande/suivi/EX-2026-ABC123?t=1',
    },
  })
  assert.equal(summarizeCspReports(tracking)[0]?.page, '/fr/commande/suivi/REDACTED')
  assert.deepEqual(summarizeCspReports('not json'), [])
  const many = JSON.stringify(
    Array.from({ length: 50 }, () => ({
      type: 'csp-violation',
      body: { effectiveDirective: 'img-src' },
    })),
  )
  assert.equal(summarizeCspReports(many).length, 10)
})

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

const report = (body: string, length = String(body.length)) =>
  new Request('http://localhost/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report', 'content-length': length },
    body,
  })

const one = JSON.stringify({
  'csp-report': {
    'document-uri': 'https://x.test/fr',
    'effective-directive': 'img-src',
    'blocked-uri': 'data',
  },
})

void test('the report endpoint logs one warning per violation, answers 204, and stays bounded', async () => {
  const { lines, log } = capture()
  let now = 0
  const handle = createCspReportHandler({ log, now: () => now, perMinute: 3 })
  for (let i = 0; i < 5; i++) assert.equal((await handle(report(one))).status, 204)
  await new Promise((resolve) => setImmediate(resolve))
  const entries = lines.map((line) => JSON.parse(line) as Record<string, string>)
  assert.equal(entries.length, 3, 'Rate limited')
  const first = entries[0] ?? {}
  assert.equal(first['level'], 'warn')
  assert.equal(first['msg'], 'csp violation')
  assert.equal(first['directive'], 'img-src')
  now = 61_000
  await handle(report(one))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(lines.length, 4, 'A new minute, a new budget')
  assert.equal((await handle(report('x'.repeat(20_000)))).status, 413)
  assert.equal((await handle(report(one, '99999'))).status, 413)
})

void test('the administration shows no Gravatar (third-party request with a hash of the email)', () => {
  assert.match(readFileSync('src/core/payload/config.ts', 'utf8'), /avatar: 'default'/)
})

void test('malformed report arrays are ignored, not thrown on', () => {
  assert.deepEqual(summarizeCspReports('[null, 1, "x", {"type":"csp-violation","body":null}]'), [])
})

void test('a chunked report body (no Content-Length) is not read past the limit', async () => {
  const { log } = capture()
  const handle = createCspReportHandler({ log })
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      sent += 4096
      if (sent > 1_000_000) controller.close()
      else controller.enqueue(new Uint8Array(4096))
    },
  })
  const request = new Request('http://localhost/api/csp-report', {
    method: 'POST',
    body,
    duplex: 'half',
  } as RequestInit)
  assert.equal((await handle(request)).status, 413)
  assert.ok(sent < 64 * 1024, `read ${sent} bytes`)
})
