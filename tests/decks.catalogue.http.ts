import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { previewCSP, previewMetaCSP } from '../src/modules/decks/application/preview'
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
  // Two more approved decks for the sort: updated (newest first) Zoologie, Ébénisterie, Verbes;
  // by name in French Ébénisterie, Verbes irréguliers, Zoologie (accents sorted as letters), in
  // English Irregular verbs, Woodwork, Zoologie (the shown edition's name); by notes (the largest
  // edition) Ébénisterie (7, its English edition), Zoologie (6), Verbes (2).
  const xavier = await author('xavier', 'ebenisterie')
  await publish(
    'fr',
    catalogueDeck({
      id: 'ebenisterie',
      edition: 'fr',
      version: 'v1',
      name: 'Ébénisterie',
      extraNotes: 1,
    }),
    xavier.token,
  )
  await publish(
    'en',
    catalogueDeck({
      id: 'ebenisterie',
      edition: 'en',
      version: 'v1',
      name: 'Woodwork',
      extraNotes: 5,
    }),
    xavier.token,
  )
  await approveDeck(payload, xavier.deck.id)
  const zoe = await author('zoe', 'zoologie')
  await publish(
    'fr',
    catalogueDeck({
      id: 'zoologie',
      edition: 'fr',
      version: 'v1',
      name: 'Zoologie',
      extraNotes: 4,
    }),
    zoe.token,
  )
  await approveDeck(payload, zoe.deck.id)

  // Maintenance on: visitors get the maintenance page, no deck.
  {
    const page = await get('/fr/decks')
    assert.ok(!page.text.includes('Verbes irréguliers'), 'catalogue hidden during maintenance')
    const home = await get('/fr')
    assert.ok(!home.text.includes('Verbes irréguliers'), 'no deck on the home during maintenance')
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
    // The exclusion is for /preview/… only: paths that merely look like it keep the baseline
    // directives (the pages under a language carry them in the proxy's full policy).
    for (const path of ['/preview', '/previewX', '/fr/preview/x']) {
      const header = (await get(path)).headers.get('content-security-policy') ?? ''
      for (const directive of ["frame-ancestors 'self'", "base-uri 'self'", "object-src 'none'"])
        assert.ok(header.includes(directive), `${path}: ${header}`)
      assert.ok(!header.includes('sandbox allow-scripts'), path)
    }
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
    for (const query of [
      '?page=-1',
      '?page=99999',
      '?lang=%22%3E',
      '?q=%25_%5C',
      '?q=a&q=b',
      '?sort=%22%3E',
      '?sort=name&sort=notes',
    ])
      assert.equal((await get(`/fr/decks${query}`)).status, 200, query)
  }

  // The sort: newest first by default (and for an unknown value), by the shown edition's name, by
  // the largest edition's notes.
  {
    const order = (html: string) =>
      ['/d/zoe/zoologie', '/d/xavier/ebenisterie', '/d/ivan/verbes']
        .map((path) => ({ path, at: html.indexOf(`${path}"`) }))
        .sort((a, b) => a.at - b.at)
        .map(({ path, at }) => (at < 0 ? `missing ${path}` : path.split('/')[3]))
    const updated = ['zoologie', 'ebenisterie', 'verbes']
    assert.deepEqual(order((await get('/fr/decks')).text), updated)
    assert.deepEqual(order((await get('/fr/decks?sort=updated')).text), updated)
    assert.deepEqual(
      order((await get('/fr/decks?sort=popular')).text),
      updated,
      'unknown → updated',
    )
    assert.deepEqual(order((await get('/fr/decks?sort=name')).text), [
      'ebenisterie',
      'verbes',
      'zoologie',
    ])
    assert.deepEqual(order((await get('/en/decks?sort=name')).text), [
      'verbes',
      'ebenisterie',
      'zoologie',
    ])
    assert.deepEqual(order((await get('/fr/decks?sort=notes')).text), [
      'ebenisterie',
      'zoologie',
      'verbes',
    ])
    // The card counts the notes of the edition it shows.
    const fr = (await get('/fr/decks?q=ebenisterie')).text
    assert.ok(fr.includes('3 notes'), 'French edition: 3 notes')
    assert.ok((await get('/en/decks?q=woodwork')).text.includes('7 notes'), 'English edition')
    // Language pills are plain links keeping the search and the sort, « Toutes les langues » first.
    const pills = (await get('/fr/decks?q=verbes&sort=name')).text
    assert.ok(pills.includes('href="/fr/decks?q=verbes&amp;sort=name"'), 'all languages')
    assert.ok(pills.includes('href="/fr/decks?q=verbes&amp;lang=en&amp;sort=name"'), 'English')
    assert.ok(
      pills.indexOf('Toutes les langues') < pills.indexOf('href="/fr/decks?q=verbes&amp;lang=en'),
    )
    // A page past the last one: an empty page with a way back, never an error.
    const beyond = await get('/fr/decks?page=99&sort=name')
    assert.equal(beyond.status, 200)
    assert.ok(beyond.text.includes('href="/fr/decks?sort=name"'), 'back to the first page')
    assert.ok(!beyond.text.includes('href="/fr/d/ivan/verbes"'))
  }

  // The homepage's « Decks récents »: approved decks only, each card leading to its page, in the
  // visitor's language; no invitation to publish the first deck once one is approved.
  {
    const home = await get('/fr')
    assert.equal(home.status, 200)
    assert.ok(home.text.includes('Decks récents'))
    assert.ok(home.text.includes('Verbes irréguliers'), 'approved deck on the home')
    assert.ok(home.text.includes('href="/fr/d/ivan/verbes"'), 'card leads to the deck page')
    assert.ok(home.text.includes('href="/fr/decks"'), 'Tout le catalogue')
    assert.ok(!home.text.includes('Deck confidentiel'), 'pending deck not on the home')
    assert.ok(!home.text.includes('Deck masqué'), 'hidden deck not on the home')
    assert.ok(!home.text.includes('Publier le premier deck'), 'no invitation once a deck exists')
    // The description as plain text: no Markdown marks, the author's HTML never rendered.
    assert.ok(!home.text.includes('**irréguliers**'))
    assert.ok(!home.text.includes('<b>pas du HTML</b>'))
    const en = await get('/en')
    assert.ok(en.text.includes('Recent decks'))
    assert.ok(en.text.includes('Irregular verbs'), 'English edition on the English home')
    assert.ok(en.text.includes('href="/en/d/ivan/verbes"'))
  }

  // The deck page.
  {
    const page = await get('/fr/d/ivan/verbes')
    assert.equal(page.status, 200)
    const html = page.text
    assert.ok(html.includes('Verbes irréguliers'))
    assert.ok(html.includes('CC-BY-4.0'))
    // « Suivre ce deck dans Anki »: a tab (a plain link) per edition, the shown edition's address
    // to copy, how to add it in Anki, the add-on's page.
    assert.ok(html.includes('Suivre ce deck dans Anki'))
    assert.ok(html.includes('href="/fr/d/ivan/verbes?edition=en"'), 'English edition tab')
    assert.ok(html.includes('href="/fr/d/ivan/verbes?edition=fr"'), 'French edition tab')
    const address = (code: string, page: string) =>
      new RegExp(`data-testid="address-${code}"[^>]*>([^<]*)<`).exec(page)?.[1]
    assert.equal(address('fr', html), `${origin}/d/ivan/verbes/fr/`, 'fr address')
    assert.ok(!html.includes('data-testid="address-en"'), 'only the shown edition’s address')
    assert.equal(
      address('en', (await get('/fr/d/ivan/verbes?edition=en')).text),
      `${origin}/d/ivan/verbes/en/`,
      'en address on its tab',
    )
    assert.ok(html.includes('Outils › DeckDock › Ajouter'))
    assert.ok(html.includes('href="https://github.com/NayanChauveau/anki-deck-manager"'))
    // « En bref »: the https homepage as « Source ».
    assert.ok(html.includes('En bref'))
    assert.ok(html.includes('href="https://example.test/verbes"'), 'Source link')
    // Description: safe Markdown, the author's HTML as text.
    assert.ok(html.includes('<strong>irréguliers</strong>'))
    assert.ok(html.includes('&lt;b&gt;pas du HTML&lt;/b&gt;'))
    // The card preview: sandboxed iframes, never the card's own content in the page.
    const frames = [...html.matchAll(/<iframe\b[^>]*>/g)].map(([tag]) => tag)
    // The carousel shows one note at a time: the first one's front and back.
    assert.equal(frames.length, 2, 'one preview note, front and back')
    for (const frame of frames) {
      assert.match(frame, /sandbox="allow-scripts"/)
      assert.ok(!frame.includes('allow-same-origin'), frame)
      assert.match(frame, /src="\/preview\/ivan\/verbes\/fr\/0\/(front|back)"/)
    }
    assert.ok(html.includes('Note 1 sur 2'), 'the carousel position')
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
    const mediaBase = `${origin}/d/ivan/verbes/fr/media/`
    assert.equal(answer.headers.get('content-security-policy'), previewCSP(mediaBase))
    assert.equal(
      previewCSP(mediaBase),
      `default-src 'none'; img-src ${mediaBase}; media-src ${mediaBase}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox allow-scripts; frame-ancestors 'self'`,
    )
    assert.ok(!(answer.headers.get('content-security-policy') ?? '').includes('allow-same-origin'))
    assert.equal(answer.headers.get('content-type'), 'text/html; charset=utf-8')
    assert.equal(answer.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(answer.headers.get('cache-control'), 'public, max-age=300')
    assert.equal(answer.headers.get('x-frame-options'), 'SAMEORIGIN')
    assert.equal(answer.headers.get('x-robots-tag'), 'noindex')
    // The same policy (no sandbox) as the head's first element, the edition's language, a title.
    assert.ok(
      answer.text.startsWith(
        `<!doctype html><html lang="fr"><head><meta http-equiv="Content-Security-Policy" content="${previewMetaCSP(mediaBase)}">`,
      ),
      answer.text.slice(0, 300),
    )
    assert.ok(answer.text.includes('<title>DeckDock Basic</title>'))
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
