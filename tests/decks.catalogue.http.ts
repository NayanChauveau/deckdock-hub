import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { previewCSP } from '../src/modules/decks/application/preview'
import { approveDeck, chooseHandle, createDeck, hideDeck } from '../src/modules/decks/server'
import { catalogueArchive, catalogueDeck } from './support/catalogue-seed'
import { present } from './support/present'

// The public catalogue, the deck page and the isolated card preview, on the production build of
// the decks stage (tests/run.mjs), after the publish and serving scripts. Decks are published
// through the real API; maintenance is on at first (the stage seeds nothing), then turned off.
if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Une base isolée finissant par _test est requise.')
const origin = present(process.env['TEST_ORIGIN'])
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

async function publish(edition: string, deck: ReturnType<typeof catalogueDeck>, token: string) {
  const response = await fetch(`${origin}/api/publish/${encodeURIComponent(edition)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/gzip', Authorization: `Bearer ${token}` },
    body: new Uint8Array(await catalogueArchive(deck)),
  })
  assert.equal(response.status, 200, await response.text())
}

async function get(path: string) {
  const response = await fetch(`${origin}${path}`, { redirect: 'manual' })
  return { status: response.status, headers: response.headers, text: await response.text() }
}

try {
  // An approved deck with two editions, a pending one and a hidden one.
  const ivan = await author('ivan', 'verbes')
  await publish('fr', catalogueDeck({ id: 'verbes', edition: 'fr', version: 'v1' }), ivan.token)
  await publish('fr', catalogueDeck({ id: 'verbes', edition: 'fr', version: 'v2' }), ivan.token)
  await publish('en', catalogueDeck({ id: 'verbes', edition: 'en', version: 'v1' }), ivan.token)
  await approveDeck(payload, ivan.deck.id)
  const judy = await author('judy', 'secret')
  await publish(
    'fr',
    catalogueDeck({ id: 'secret', edition: 'fr', version: 'v1', name: 'Deck confidentiel' }),
    judy.token,
  )
  const mallory = await author('mallory', 'ancien')
  await publish(
    'fr',
    catalogueDeck({ id: 'ancien', edition: 'fr', version: 'v1', name: 'Deck masqué' }),
    mallory.token,
  )
  await approveDeck(payload, mallory.deck.id)
  await hideDeck(payload, mallory.deck.id, 'test')

  // Maintenance on: visitors get the maintenance page, no deck.
  {
    const page = await get('/fr/decks')
    assert.ok(!page.text.includes('Verbes irréguliers'), 'catalogue hidden during maintenance')
  }
  await payload.updateGlobal({ slug: 'site-settings', data: { maintenance: false } })

  // The catalogue: approved decks only, searched without case or accents, filtered by language.
  {
    const page = await get('/fr/decks')
    assert.equal(page.status, 200)
    assert.ok(page.text.includes('Verbes irréguliers'), 'French edition shown in French')
    assert.ok(page.text.includes('href="/fr/d/ivan/verbes"'))
    assert.ok(!page.text.includes('Deck confidentiel'), 'pending deck not listed')
    assert.ok(!page.text.includes('Deck masqué'), 'hidden deck not listed')
    // The site's page policy frames only the site's own documents (the card previews).
    const policy = page.headers.get('content-security-policy') ?? ''
    assert.ok(policy.includes("frame-src 'self'"), policy)
    // The baseline policy still covers every other path (next.config.mjs skips /preview/ only).
    assert.equal(
      (await get('/robots.txt')).headers.get('content-security-policy'),
      "frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
    )
    assert.ok(
      (await get('/en/decks')).text.includes('Irregular verbs'),
      'English edition in English',
    )
    for (const q of ['IRREGULIERS', 'irréguliers', 'Conjugaison', 'ÉTÉ'])
      assert.ok(
        (await get(`/fr/decks?q=${encodeURIComponent(q)}`)).text.includes('Verbes irréguliers'),
        q,
      )
    const none = await get('/fr/decks?q=zzzz')
    assert.ok(none.text.includes('Aucun deck trouvé.'))
    assert.ok(!none.text.includes('href="/fr/d/ivan/verbes"'))
    assert.ok((await get('/fr/decks?lang=en')).text.includes('href="/fr/d/ivan/verbes"'))
    assert.ok(!(await get('/fr/decks?lang=de')).text.includes('href="/fr/d/ivan/verbes"'))
    assert.ok(!(await get('/fr/decks?q=confidentiel')).text.includes('Deck confidentiel'))
    // Odd parameters are ignored, never an error.
    for (const query of ['?page=-1', '?page=99999', '?lang=%22%3E', '?q=%25_%5C', '?q=a&q=b'])
      assert.equal((await get(`/fr/decks${query}`)).status, 200, query)
  }

  // The deck page.
  {
    const page = await get('/fr/d/ivan/verbes')
    assert.equal(page.status, 200)
    const html = page.text
    assert.ok(html.includes('Verbes irréguliers'))
    assert.ok(html.includes('CC-BY-4.0'))
    assert.ok(html.includes(`${origin}/d/ivan/verbes/fr/`), 'fr address')
    assert.ok(html.includes(`${origin}/d/ivan/verbes/en/`), 'en address')
    // Description: safe Markdown, the author's HTML as text.
    assert.ok(html.includes('<strong>irréguliers</strong>'))
    assert.ok(html.includes('&lt;b&gt;pas du HTML&lt;/b&gt;'))
    // The card preview: sandboxed iframes, never the card's own content in the page.
    const frames = [...html.matchAll(/<iframe\b[^>]*>/g)].map(([tag]) => tag)
    assert.equal(frames.length, 4, 'two preview notes, front and back')
    for (const frame of frames) {
      assert.match(frame, /sandbox="allow-scripts"/)
      assert.ok(!frame.includes('allow-same-origin'), frame)
      assert.match(frame, /src="\/preview\/ivan\/verbes\/fr\/[01]\/(front|back)"/)
    }
    assert.ok(!html.includes('CARD_SCRIPT_MARKER'), 'template content stays out of the page')
    // The version history of the shown edition, newest first.
    assert.ok(html.indexOf('>v2<') < html.indexOf('>v1<'), 'history newest first')
    // English visitor: the English edition by default; an edition can be chosen.
    const en = await get('/en/d/ivan/verbes')
    assert.ok(en.text.includes('Irregular verbs'))
    assert.ok(en.text.includes('src="/preview/ivan/verbes/en/0/front"'))
    assert.ok((await get('/en/d/ivan/verbes?edition=fr')).text.includes('Verbes irréguliers'))
  }

  // Pending: not found for anyone but its author; hidden: withdrawn (a 404 page, see DeckNotFound).
  {
    const pending = await get('/fr/d/judy/secret')
    assert.equal(pending.status, 404)
    assert.ok(!pending.text.includes('Deck confidentiel'))
    const hidden = await get('/fr/d/mallory/ancien')
    assert.equal(hidden.status, 404)
    assert.ok(hidden.text.includes('Deck retiré'))
    assert.ok((await get('/en/d/mallory/ancien')).text.includes('Deck withdrawn'))
    const unknown = await get('/fr/d/nobody/nothing')
    assert.equal(unknown.status, 404)
    assert.ok(unknown.text.includes('Deck introuvable'))
  }

  // The preview document: its own strict policy, exactly one, sandboxed without same-origin.
  {
    const answer = await get('/preview/ivan/verbes/fr/0/front')
    assert.equal(answer.status, 200, answer.text)
    assert.equal(answer.headers.get('content-security-policy'), previewCSP(origin))
    assert.equal(
      previewCSP(origin),
      `default-src 'none'; img-src ${origin}; media-src ${origin}; style-src 'unsafe-inline'; sandbox allow-scripts; frame-ancestors 'self'`,
    )
    assert.ok(!(answer.headers.get('content-security-policy') ?? '').includes('allow-same-origin'))
    assert.equal(answer.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(answer.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(answer.headers.get('cache-control'), 'public, max-age=300')
    assert.equal(answer.headers.get('x-frame-options'), 'SAMEORIGIN')
    assert.equal(answer.headers.get('x-robots-tag'), 'noindex')
    assert.ok(answer.text.startsWith('<!doctype html>'))
    assert.ok(answer.text.includes('.card { font-family: serif; }'), 'notetype CSS')
    assert.ok(answer.text.includes(`<img src="${origin}/d/ivan/verbes/fr/media/a.png" alt="">`))
    assert.ok(answer.text.includes('CARD_SCRIPT_MARKER'), 'the template, scripts included')
    const back = await get('/preview/ivan/verbes/fr/1/back')
    assert.ok(back.text.includes('<span class="cloze">parti</span>'), back.text)
    const front = await get('/preview/ivan/verbes/fr/1/front')
    assert.ok(front.text.includes('<span class="cloze">[...]</span>'), front.text)
    // Its media URL is served by the hub.
    assert.equal((await get('/d/ivan/verbes/fr/media/a.png')).status, 200)
    for (const path of [
      '/preview/judy/secret/fr/0/front',
      '/preview/mallory/ancien/fr/0/front',
      '/preview/ivan/verbes/fr/2/front',
      '/preview/ivan/verbes/fr/0/side',
      '/preview/ivan/verbes/de/0/front',
      '/preview/IVAN/verbes/fr/0/front',
      '/preview/ivan/verbes/fr/00/front',
    ]) {
      const missing = await get(path)
      assert.equal(missing.status, 404, path)
      assert.equal(missing.headers.get('cache-control'), 'no-store', path)
      assert.ok(!missing.text.includes('CARD_SCRIPT_MARKER'), path)
    }
  }

  console.log('Catalogue, page de deck et aperçu isolé : recherche, langues, statuts, CSP.')
} finally {
  await payload.destroy()
}
