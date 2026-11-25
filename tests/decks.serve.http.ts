import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { chooseHandle, createDeck } from '../src/modules/decks/server'
import { deckJson, editionArchive, MEDIA, sha256 } from './support/deck-archive'
import { present } from './support/present'

// Serving published decks in the format's "Publishing layout" (/d/<handle>/<deck>/…), on the
// production build of the publish stage (tests/run.mjs). Decks are published through the real
// publish API, then read back byte for byte, and fetched by the add-on's own code.
if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Une base isolée finissant par _test est requise.')
const origin = present(process.env['TEST_ORIGIN'])
const dataDir = present(process.env['HUB_DATA_DIR'])
const payload = await getPayload({ config })

async function author(handle: string, deckId: string) {
  const customer = await payload.create({
    collection: 'customers',
    data: {
      authUserId: randomUUID(),
      email: `${handle}-${randomBytes(3).toString('hex')}@example.test`,
    },
    overrideAccess: true,
  })
  await chooseHandle(payload, customer.id, handle)
  const { deck, token } = await createDeck(payload, customer.id, deckId)
  return { customerId: customer.id, deck, token }
}

async function publish(edition: string, body: Buffer, token: string) {
  const response = await fetch(`${origin}/api/publish/${encodeURIComponent(edition)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip', Authorization: `Bearer ${token}` },
    body: new Uint8Array(body),
  })
  const text = await response.text()
  assert.equal(response.status, 200, text)
}

async function get(
  path: string,
  headers: Record<string, string> = {},
  method = 'GET',
  redirect: RequestRedirect = 'manual',
) {
  const response = await fetch(`${origin}${path}`, { method, headers, redirect })
  const body = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, body, text: body.toString('utf8') }
}

/** Every error answer is tiny, says nothing about the server, and is never cached long. */
function assertBareError(answer: Awaited<ReturnType<typeof get>>, status: number, path: string) {
  assert.equal(answer.status, status, `${path}: ${answer.text.slice(0, 200)}`)
  assert.ok(answer.body.length <= 64, `${path}: ${answer.text}`)
  assert.ok(!answer.text.includes(dataDir), answer.text)
  assert.ok(!/\bat .+\.(js|ts):\d+/.test(answer.text), answer.text)
  assert.ok(!/html/i.test(answer.headers.get('content-type') ?? ''), path)
  assert.equal(answer.headers.get('x-content-type-options'), 'nosniff')
}

const CSP = "default-src 'none'; sandbox"
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>',
)
const HTML = Buffer.from('<!doctype html><script>alert(document.domain)</script>')
const SVG_NAME = 'a b é.svg'

/** A deck `verbs` edition with extra media: an SVG with a script, an HTML file. */
function edition(code: string, version: string, name: string, language: string[]) {
  const base = deckJson({ edition: code, version })
  const deck = {
    ...base,
    deck: { ...base.deck, name, language },
    media: [
      ...base.media,
      { filename: SVG_NAME, sha256: sha256(SVG), size: SVG.length },
      { filename: 'page.html', sha256: sha256(HTML), size: HTML.length },
    ],
  }
  return deck
}
const archiveOf = (deck: ReturnType<typeof edition>) =>
  editionArchive(deck, [
    { name: `media/${SVG_NAME}`, body: SVG },
    { name: 'media/page.html', body: HTML },
  ])
const indexOf = (...decks: ReturnType<typeof edition>[]) =>
  JSON.stringify(
    {
      format: 'deckdock-index/1',
      editions: decks.map(({ deck }) => ({
        edition: deck.edition,
        name: deck.name,
        language: deck.language,
        version: deck.version,
      })),
    },
    null,
    2,
  ) + '\n'

try {
  // The suite runs with the site in maintenance (its default, nothing seeded): serving, like
  // publishing, stays open so that an author can test a deck before the site opens.
  const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
  assert.notEqual(settings.maintenance, false)

  const frank = await author('frank', 'verbs')
  const en1 = edition('en', '2026-11-26-v1', 'Irregular verbs', ['en'])
  const fr1 = edition('fr', '2026-11-26-v1', 'Verbes irréguliers', ['fr'])
  await publish('fr', await archiveOf(fr1), frank.token)
  await publish('en', await archiveOf(en1), frank.token)
  const base = '/d/frank/verbs'

  // index.json of a pending deck: deckdock-index/1, sorted by edition, noindex.
  const index = await get(`${base}/index.json`)
  {
    assert.equal(index.status, 200, index.text)
    assert.equal(index.text, indexOf(en1, fr1))
    assert.match(present(index.headers.get('content-type')), /^application\/json/)
    assert.equal(index.headers.get('etag'), `"${sha256(index.body)}"`)
    assert.equal(index.headers.get('cache-control'), 'public, max-age=300')
    assert.equal(index.headers.get('x-robots-tag'), 'noindex')
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(index.headers.get('content-security-policy'), CSP)
  }

  // deck.json: the published bytes, its digest as ETag.
  const deckText = JSON.stringify(en1)
  const deck = await get(`${base}/en/deck.json`)
  {
    assert.equal(deck.status, 200, deck.text)
    assert.equal(deck.text, deckText)
    assert.match(present(deck.headers.get('content-type')), /^application\/json/)
    assert.equal(deck.headers.get('etag'), `"${sha256(deckText)}"`)
    assert.equal(deck.headers.get('cache-control'), 'public, max-age=300')
    assert.equal(deck.headers.get('content-security-policy'), CSP)
    // next start gzips JSON for clients that ask (fetch does, the add-on's urllib doesn't).
    const identity = await get(`${base}/en/deck.json`, { 'Accept-Encoding': 'identity' })
    assert.equal(identity.text, deckText)
    assert.equal(identity.headers.get('content-encoding'), null)
    assert.equal(deck.headers.get('x-robots-tag'), 'noindex')
    const fr = await get(`${base}/fr/deck.json`)
    assert.equal(fr.text, JSON.stringify(fr1))
  }

  // Media: the bytes, immutable, a sandbox CSP, its type from the extension.
  {
    const png = await get(`${base}/en/media/a.png`)
    assert.equal(png.status, 200, png.text)
    assert.ok(png.body.equals(MEDIA))
    assert.equal(png.headers.get('content-type'), 'image/png')
    assert.equal(png.headers.get('etag'), `"${sha256(MEDIA)}"`)
    assert.equal(png.headers.get('cache-control'), 'public, max-age=31536000, immutable')
    assert.equal(png.headers.get('content-security-policy'), CSP)
    assert.equal(png.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(png.headers.get('content-disposition'), "inline; filename*=UTF-8''a.png")
    assert.equal(png.headers.get('cross-origin-resource-policy'), 'cross-origin')
    assert.equal(png.headers.get('x-robots-tag'), 'noindex')
    assert.equal(png.headers.get('accept-ranges'), null)

    // An SVG holding a script (point 4): served, but sandboxed and never sniffed.
    const svg = await get(`${base}/en/media/${encodeURIComponent(SVG_NAME)}`)
    assert.equal(svg.status, 200, svg.text)
    assert.ok(svg.body.equals(SVG))
    assert.equal(svg.headers.get('content-type'), 'image/svg+xml')
    assert.equal(svg.headers.get('content-security-policy'), CSP)
    assert.equal(svg.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(
      svg.headers.get('content-disposition'),
      "inline; filename*=UTF-8''a%20b%20%C3%A9.svg",
    )

    // An HTML file is never served as HTML.
    const html = await get(`${base}/en/media/page.html`)
    assert.equal(html.status, 200)
    assert.ok(html.body.equals(HTML))
    assert.equal(html.headers.get('content-type'), 'application/octet-stream')
    assert.equal(html.headers.get('content-security-policy'), CSP)

    // HEAD: the same headers, no body.
    const head = await get(`${base}/en/media/a.png`, {}, 'HEAD')
    assert.equal(head.status, 200)
    assert.equal(head.body.length, 0)
    assert.equal(head.headers.get('etag'), `"${sha256(MEDIA)}"`)
    assert.equal(head.headers.get('content-type'), 'image/png')
  }

  // If-None-Match: 304 with the ETag and Cache-Control, on all three kinds; otherwise 200.
  {
    const cases: [string, string, string][] = [
      [`${base}/index.json`, present(index.headers.get('etag')), 'public, max-age=300'],
      [`${base}/en/deck.json`, `"${sha256(deckText)}"`, 'public, max-age=300'],
      [`${base}/en/media/a.png`, `"${sha256(MEDIA)}"`, 'public, max-age=31536000, immutable'],
    ]
    for (const [path, etag, cache] of cases) {
      for (const header of [etag, `"nope", ${etag}`, '*', `W/${etag}`]) {
        const answer = await get(path, { 'If-None-Match': header })
        assert.equal(answer.status, 304, `${path} ${header}`)
        assert.equal(answer.body.length, 0)
        assert.equal(answer.headers.get('etag'), etag)
        assert.equal(answer.headers.get('cache-control'), cache)
      }
      const other = await get(path, { 'If-None-Match': `"${'0'.repeat(64)}"` })
      assert.equal(other.status, 200, path)
    }
  }

  // Unknown handle, deck, edition or file: 404, the same bare answer whatever is unknown.
  {
    const unknownHandle = await get('/d/nobody/verbs/index.json')
    const unknownDeck = await get('/d/frank/nouns/index.json')
    assertBareError(unknownHandle, 404, 'unknown handle')
    assertBareError(unknownDeck, 404, 'unknown deck')
    assert.equal(unknownHandle.text, unknownDeck.text)
    assert.equal(unknownHandle.headers.get('content-type'), unknownDeck.headers.get('content-type'))
    for (const path of [
      `${base}/de/deck.json`,
      `${base}/en/media/missing.png`,
      `${base}/en/media/deck.json`,
      `${base}/en/media/..%2Fdeck.json`,
      `${base}/en/media/__proto__`,
      `${base}/en/media/a.png/extra`,
      `${base}/en/other.json`,
      `${base}/en`,
      `${base}/en/media`,
      '/d/FRANK/verbs/index.json',
      '/d/frank/Verbs/index.json',
    ])
      assertBareError(await get(path), 404, path)
    // Malformed percent-encoding: Next.js refuses it before the route (a bare text error).
    const malformed = await get(`${base}/en/media/%E0%A4%A`)
    assert.ok(malformed.status >= 400, String(malformed.status))
    assert.ok(malformed.body.length <= 64 && !malformed.text.includes(dataDir), malformed.text)
    assert.ok(!/html/i.test(malformed.headers.get('content-type') ?? ''))
    // `..` percent-encoded is resolved by the URL parser to `<base>/en/`, which Next.js redirects
    // to `<base>/en`: unknown as well.
    const dots = await get(`${base}/en/media/%2E%2E`)
    assert.equal(dots.status, 308)
    assert.equal(dots.headers.get('location'), `${base}/en`)
    assertBareError(await get(`${base}/en/media/%2E%2E`, {}, 'GET', 'follow'), 404, 'dots')
  }

  // The add-on's own code (deckdock/addon, its embedded library) reads the edition from the
  // address the deck page gives, `<base>/<edition>/`.
  const addon = resolve(process.env['DECKDOCK_ADDON_SRC'] || '../deckdock/addon/src')
  if (!existsSync(resolve(addon, 'deckdock_addon/sources.py'))) {
    console.log(`SKIP : test réel du plugin, ${addon} absent (dépôt deckdock non cloné à côté).`)
  } else {
    const { stdout } = await promisify(execFile)(
      present(process.env['HUB_PYTHON']),
      ['-P', resolve('tests/decks.addon.test.py'), origin, `${base}/`, 'en'],
      {
        env: {
          NODE_ENV: 'test',
          PATH: process.env['PATH'] ?? '',
          PYTHONPATH: addon,
          PYTHONUTF8: '1',
        },
        timeout: 60_000,
      },
    )
    assert.match(stdout, /^addon ok: verbs en 2026-11-26-v1, 3 media, index 2 editions$/m, stdout)
  }

  // Approved: no noindex. A new version replaces the old one everywhere.
  {
    await payload.update({
      collection: 'decks',
      id: frank.deck.id,
      data: { status: 'approved' },
      overrideAccess: true,
    })
    const en2 = edition('en', '2026-11-26-v2', 'Irregular verbs', ['en'])
    await publish('en', await archiveOf(en2), frank.token)
    const next = await get(`${base}/index.json`)
    assert.equal(next.text, indexOf(en2, fr1))
    assert.equal(next.headers.get('x-robots-tag'), null)
    const nextDeck = await get(`${base}/en/deck.json`, { 'If-None-Match': `"${sha256(deckText)}"` })
    assert.equal(nextDeck.status, 200)
    assert.equal(nextDeck.text, JSON.stringify(en2))
    assert.equal(nextDeck.headers.get('x-robots-tag'), null)
  }

  // A deck with no published edition yet: an empty index, no deck.json.
  {
    await author('grace', 'idioms')
    const empty = await get('/d/grace/idioms/index.json')
    assert.equal(empty.status, 200, empty.text)
    assert.equal(empty.text, indexOf())
    assertBareError(await get('/d/grace/idioms/en/deck.json'), 404, 'no edition')
  }

  // Hidden: 410 everywhere.
  {
    await payload.update({
      collection: 'decks',
      id: frank.deck.id,
      data: { status: 'hidden', hiddenReason: 'test' },
      overrideAccess: true,
    })
    for (const path of [`${base}/index.json`, `${base}/en/deck.json`, `${base}/en/media/a.png`])
      assertBareError(await get(path), 410, path)
  }

  console.log('Service au plugin : index, deck, médias, ETag/304, noindex, 404/410, plugin réel.')
} finally {
  await payload.destroy()
}
