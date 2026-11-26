import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  catalogue,
  deckGone,
  deckPage,
  defaultEdition,
  previewCard,
  type CatalogueDeps,
  type CatalogueStore,
  type PublicEdition,
} from '../src/modules/decks/application/catalogue'
import {
  cardDocument,
  previewCSP,
  previewMetaCSP,
  renderCard,
} from '../src/modules/decks/application/preview'
import {
  MAX_DESCRIPTION_CHARS,
  MAX_SUMMARY_SOURCE_CHARS,
  markdownText,
  parseMarkdown,
  truncateDescription,
} from '../src/modules/decks/domain/markdown'
import {
  mediaReferences,
  parsePreview,
  previewOf,
  type Note,
  type Notetype,
} from '../src/modules/decks/domain/preview'
import { foldSearch, searchText } from '../src/modules/decks/domain/search'
import { present } from './support/present'

const basic: Notetype = {
  id: 'basic',
  name: 'Basic',
  kind: 'standard',
  fields: ['Front', 'Back', 'Extra'],
  templates: [
    { name: 'Card 1', front: '<div>{{Front}}</div>', back: '{{FrontSide}}<hr id=answer>{{Back}}' },
  ],
  css: '.card { background: url("bg.png"); } .x { background: url(missing.png) }',
}
const cloze: Notetype = {
  id: 'cloze',
  name: 'Cloze',
  kind: 'cloze',
  fields: ['Text', 'Extra'],
  templates: [{ name: 'Cloze', front: '{{cloze:Text}}', back: '{{cloze:Text}}<br>{{Extra}}' }],
  css: '',
}
const note = (fields: Record<string, string>, notetype = 'basic'): Note => ({
  notetype,
  fields,
  tags: ['verbs', 'a1'],
})
const known = new Set(['a.png', 'a b.png', 'hello.mp3', 'bg.png', 'a&b.png'])
const media = (name: string) =>
  known.has(name) ? `https://hub.test/d/alice/verbs/en/media/${encodeURIComponent(name)}` : ''

void test('renderCard: a plain field, HTML kept as is (fields are HTML in Anki)', () => {
  const html = renderCard(basic, note({ Front: '<b>go</b>', Back: 'went' }), 0, 'front', media)
  assert.equal(html, '<div><b>go</b></div>')
})

void test('renderCard: FrontSide on the back is the rendered front', () => {
  const html = renderCard(basic, note({ Front: 'go', Back: 'went' }), 0, 'back', media)
  assert.equal(html, '<div>go</div><hr id=answer>went')
  // On the front, FrontSide is empty.
  const front: Notetype = {
    ...basic,
    templates: [{ name: 'c', front: 'a{{FrontSide}}b', back: '' }],
  }
  assert.equal(renderCard(front, note({ Front: 'go' }), 0, 'front', media), 'ab')
})

void test('renderCard: cloze c1 masked on the front, revealed on the back', () => {
  const text = 'The {{c1::cat}} sat on the {{c2::mat::thing}}.'
  const fields = { Text: text, Extra: 'note' }
  assert.equal(
    renderCard(cloze, note(fields, 'cloze'), 0, 'front', media),
    'The <span class="cloze">[...]</span> sat on the mat.',
  )
  assert.equal(
    renderCard(cloze, note(fields, 'cloze'), 0, 'back', media),
    'The <span class="cloze">cat</span> sat on the mat.<br>note',
  )
  // A hint is shown in place of [...]; the first deletion is the lowest number.
  const hinted = { Text: '{{c3::Paris::capital}} and {{c2::Rome::city}}', Extra: '' }
  assert.equal(
    renderCard(cloze, note(hinted, 'cloze'), 0, 'front', media),
    'Paris and <span class="cloze">[city]</span>',
  )
})

void test('renderCard: conditional sections, empty and filled', () => {
  const nt: Notetype = {
    ...basic,
    templates: [
      {
        name: 'c',
        front: '{{#Extra}}[{{Extra}}]{{/Extra}}{{^Extra}}none{{/Extra}}|{{#Back}}B{{/Back}}',
        back: '',
      },
    ],
  }
  assert.equal(
    renderCard(nt, note({ Front: 'f', Back: 'b', Extra: '' }), 0, 'front', media),
    'none|B',
  )
  assert.equal(
    renderCard(nt, note({ Front: 'f', Back: '<br> ', Extra: 'x' }), 0, 'front', media),
    '[x]|',
  )
  // Nested sections.
  const nested: Notetype = {
    ...basic,
    templates: [{ name: 'c', front: '{{#Front}}a{{#Back}}b{{/Back}}c{{/Front}}', back: '' }],
  }
  assert.equal(renderCard(nested, note({ Front: 'f', Back: '' }), 0, 'front', media), 'ac')
})

void test('renderCard: unknown filters are dropped without error, unknown fields are empty', () => {
  const nt: Notetype = {
    ...basic,
    templates: [
      {
        name: 'Card 1',
        front:
          '{{hint:Front}}/{{text:furigana:Back}}/{{tts en_US:Front}}/{{Nope}}/{{Tags}}/{{Type}}/{{Card}}',
        back: '{{/Back}}{{#Missing}}x',
      },
    ],
  }
  assert.equal(
    renderCard(nt, note({ Front: 'go', Back: 'went' }), 0, 'front', media),
    'go/went/go//verbs a1/Basic/Card 1',
  )
  // Unbalanced tags never throw.
  assert.doesNotThrow(() => renderCard(nt, note({ Front: 'go' }), 0, 'back', media))
  // A template index out of range renders nothing.
  assert.equal(renderCard(nt, note({ Front: 'go' }), 3, 'front', media), '')
})

void test('renderCard: media references become the hub URLs; unknown names are dropped', () => {
  const nt: Notetype = {
    ...basic,
    templates: [{ name: 'c', front: '{{Front}}', back: '' }],
  }
  const html = renderCard(
    nt,
    note({
      Front:
        '<img src="a.png"><img SRC=\'a%20b.png\'><img src=a&amp;b.png>[sound:hello.mp3]' +
        '<img src="nope.png">[sound:nope.mp3]<img src="https://elsewhere.test/x.png">',
    }),
    0,
    'front',
    media,
  )
  assert.equal(
    html,
    '<img src="https://hub.test/d/alice/verbs/en/media/a.png">' +
      '<img src="https://hub.test/d/alice/verbs/en/media/a%20b.png">' +
      '<img src="https://hub.test/d/alice/verbs/en/media/a%26b.png">' +
      '<audio controls src="https://hub.test/d/alice/verbs/en/media/hello.mp3"></audio>' +
      '<img src="">' +
      '<img src="https://elsewhere.test/x.png">',
  )
})

const MEDIA_BASE = 'https://hub.test/d/alice/verbs/en/media/'

void test('cardDocument: the notetype CSS (media rewritten) and the card in one document', () => {
  const doc = cardDocument(basic, '<p>go</p>', media, {
    mediaBase: MEDIA_BASE,
    lang: 'en-GB',
    title: 'Basic <1>',
  })
  // The policy (without sandbox, which a meta cannot set) is the head's first element: scripts stay
  // blocked even if the header were lost.
  assert.ok(
    doc.startsWith(
      `<!doctype html><html lang="en-GB"><head><meta http-equiv="Content-Security-Policy" content="${previewMetaCSP(MEDIA_BASE)}">`,
    ),
    doc.slice(0, 300),
  )
  assert.ok(doc.includes('<meta charset="utf-8">'))
  assert.ok(doc.includes('<title>Basic &lt;1&gt;</title>'))
  assert.ok(doc.includes('url("https://hub.test/d/alice/verbs/en/media/bg.png")'))
  assert.ok(doc.includes('url("")'))
  assert.ok(doc.includes('<body class="card"><p>go</p></body>'))
  // A language that is not a language tag is left out; </style can never close the style element.
  const odd = cardDocument(
    { ...basic, css: 'a { content: "</STYLE><script>x()</script>" }' },
    '',
    media,
    { mediaBase: MEDIA_BASE, lang: 'en" onload="x', title: 't' },
  )
  assert.ok(odd.startsWith('<!doctype html><html><head>'))
  assert.equal((odd.match(/<\/style/gi) ?? []).length, 1, 'only the real closing tag')
  assert.ok(odd.includes('<\\/STYLE>'))
})

void test('previewCSP: the brief policy tightened, sandboxed scripts without allow-same-origin', () => {
  const policy = previewCSP(MEDIA_BASE)
  assert.equal(
    policy,
    "default-src 'none'; img-src https://hub.test/d/alice/verbs/en/media/; media-src https://hub.test/d/alice/verbs/en/media/; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; sandbox allow-scripts; frame-ancestors 'self'",
  )
  assert.ok(!policy.includes('allow-same-origin'))
  assert.equal(
    previewMetaCSP(MEDIA_BASE),
    "default-src 'none'; img-src https://hub.test/d/alice/verbs/en/media/; media-src https://hub.test/d/alice/verbs/en/media/; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  )
})

void test('previewOf: an oversized notetype (CSS or template) is left out with its notes', () => {
  const huge = 'x'.repeat(200_001)
  const deck = {
    deck: { language: ['fr', 'en'] },
    notetypes: [
      { ...basic, id: 'big-css', css: huge },
      { ...basic, id: 'big-tpl', templates: [{ name: 'c', front: huge, back: '' }] },
      { ...basic, id: 'ok' },
    ],
    notes: [
      { notetype: 'big-css', fields: { Front: '1' }, tags: [] },
      { notetype: 'big-tpl', fields: { Front: '2' }, tags: [] },
      { notetype: 'ok', fields: { Front: '3' }, tags: [] },
    ],
    media: [],
  }
  const preview = previewOf(deck)
  assert.deepEqual(
    preview.notetypes.map((n) => n.id),
    ['ok'],
  )
  assert.deepEqual(
    preview.notes.map((n) => n.fields['Front']),
    ['3'],
  )
  // The edition's first language, for the document's lang.
  assert.equal(preview.language, 'fr')
})

void test('previewOf: at most 5 notes, one per notetype first, then in file order', () => {
  const nt = (id: string) => ({
    ...basic,
    id,
    templates: [{ name: 'c', front: '{{Front}}', back: '' }],
  })
  const deck = {
    deck: { id: 'x' },
    notetypes: [nt('a'), nt('b'), nt('c'), { ...cloze, css: '.c { background: url(bg.png) }' }],
    notes: [
      { guid: '1', notetype: 'a', deck: '', fields: { Front: '1' }, tags: [] },
      { guid: '2', notetype: 'a', deck: '', fields: { Front: '<img src="a.png">' }, tags: [] },
      { guid: '3', notetype: 'b', deck: '', fields: { Front: '3' }, tags: [] },
      { guid: '4', notetype: 'a', deck: '', fields: { Front: '4' }, tags: [] },
      { guid: '5', notetype: 'cloze', deck: '', fields: { Text: '[sound:hello.mp3]' }, tags: [] },
      { guid: '6', notetype: 'a', deck: '', fields: { Front: '<img src="nope.png">' }, tags: [] },
      { guid: '7', notetype: 'c', deck: '', fields: { Front: '7' }, tags: ['t'] },
    ],
    media: [
      { filename: 'a.png', sha256: 'x', size: 1 },
      { filename: 'hello.mp3', sha256: 'x', size: 1 },
      { filename: 'bg.png', sha256: 'x', size: 1 },
      { filename: 'unused.png', sha256: 'x', size: 1 },
    ],
  }
  const preview = previewOf(deck)
  assert.deepEqual(
    preview.notes.map((n) => n.fields['Front'] ?? n.fields['Text']),
    ['1', '3', '[sound:hello.mp3]', '7', '<img src="a.png">'],
  )
  assert.deepEqual(
    preview.notetypes.map((n) => n.id),
    ['a', 'b', 'c', 'cloze'],
  )
  // Only the listed files these notes and notetypes refer to.
  assert.deepEqual(preview.media, ['a.png', 'bg.png', 'hello.mp3'])
  assert.deepEqual(present(preview.notes[3]).tags, ['t'])
  // Stored, then read back unchanged; anything malformed is null.
  assert.deepEqual(parsePreview(JSON.parse(JSON.stringify(preview))), preview)
  assert.equal(parsePreview(null), null)
  assert.equal(parsePreview({ notes: 'x' }), null)
  // A malformed deck.json gives an empty preview, never an error.
  assert.deepEqual(previewOf({ notes: [{ notetype: 'zz' }] }), {
    notetypes: [],
    notes: [],
    media: [],
  })
})

void test('mediaReferences: the format patterns, unescaped and percent-decoded', () => {
  assert.deepEqual(
    mediaReferences(
      '<img src="a%20b.png"> <img src=\'c&amp;d.png\'> [sound:e.mp3] url(f.png) url("g.png") ' +
        '<img src="http://x/y.png"> <img src="/abs.png"> <img src="data:image/png;base64,x"> <img src="{{Front}}">',
    ),
    ['a b.png', 'c&d.png', 'e.mp3', 'f.png', 'g.png'],
  )
})

void test('search: case- and accent-insensitive folding of the name and description', () => {
  assert.equal(foldSearch('Verbes IRRÉGULIERS à Noël'), 'verbes irreguliers a noel')
  assert.equal(searchText('Être', 'Les **verbes**'), 'etre\nles **verbes**')
  assert.equal(searchText('Être', null), 'etre')
})

void test('markdown: blocks and inline marks, never raw HTML, only safe links', () => {
  const blocks = parseMarkdown(
    '# Title\n\nSome **bold**, *em* and `code` <script>x</script>.\n[site](https://ex.test) [bad](javascript:alert)\n\n- one\n- two\n\n1. first\n\n```\n<b>raw</b>\n```\n\n> quoted',
  )
  assert.deepEqual(blocks[0], {
    kind: 'heading',
    level: 1,
    content: [{ kind: 'text', text: 'Title' }],
  })
  const paragraph = present(blocks[1])
  assert.equal(paragraph.kind, 'paragraph')
  assert.deepEqual(paragraph.content, [
    { kind: 'text', text: 'Some ' },
    { kind: 'strong', content: [{ kind: 'text', text: 'bold' }] },
    { kind: 'text', text: ', ' },
    { kind: 'em', content: [{ kind: 'text', text: 'em' }] },
    { kind: 'text', text: ' and ' },
    { kind: 'code', text: 'code' },
    { kind: 'text', text: ' <script>x</script>. ' },
    { kind: 'link', href: 'https://ex.test', content: [{ kind: 'text', text: 'site' }] },
    { kind: 'text', text: ' ' },
    { kind: 'text', text: 'bad' },
  ])
  assert.deepEqual(blocks[2], {
    kind: 'list',
    ordered: false,
    items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]],
  })
  assert.deepEqual(blocks[3], {
    kind: 'list',
    ordered: true,
    items: [[{ kind: 'text', text: 'first' }]],
  })
  assert.deepEqual(blocks[4], { kind: 'codeblock', text: '<b>raw</b>' })
  assert.deepEqual(blocks[5], { kind: 'quote', content: [{ kind: 'text', text: 'quoted' }] })
  assert.deepEqual(parseMarkdown('   \n'), [])
})

// --- Catalogue and deck page use cases, on a fake store. ---

const edition = (
  code: string,
  languages: string[],
  over: Partial<PublicEdition> = {},
): PublicEdition => ({
  code,
  name: `Deck ${code}`,
  description: `About ${code}`,
  languages,
  license: 'CC-BY-4.0',
  homepage: 'https://ex.test',
  notes: 12,
  version: 'v2',
  receivedAt: new Date('2026-11-26T10:00:00Z'),
  versions: [
    { version: 'v2', receivedAt: new Date('2026-11-26T10:00:00Z'), notes: 12 },
    { version: 'v1', receivedAt: new Date('2026-11-20T10:00:00Z'), notes: 10 },
  ],
  previews: 2,
  ...over,
})

function fakeStore(
  decks: Record<
    string,
    { id: number; status: 'pending' | 'approved' | 'hidden'; customerId: number | null }
  >,
) {
  const calls: string[] = []
  const preview = previewOf({
    notetypes: [basic],
    notes: [
      { notetype: 'basic', fields: { Front: '<img src="a.png">', Back: 'b', Extra: '' }, tags: [] },
      { notetype: 'basic', fields: { Front: 'two', Back: 'b', Extra: '' }, tags: [] },
    ],
    media: [{ filename: 'a.png' }],
  })
  const store: CatalogueStore = {
    search: async (input) => {
      calls.push(`search:${JSON.stringify(input)}`)
      return {
        total: 41,
        decks: [
          {
            handle: 'alice',
            deckId: 'verbs',
            updatedAt: new Date('2026-11-26T10:00:00Z'),
            editions: [
              { code: 'en', name: 'Verbs', description: 'English', languages: ['en'] },
              { code: 'fr', name: 'Verbes', description: 'Français', languages: ['fr', 'en'] },
            ],
          },
        ],
      }
    },
    languages: async () => ['en', 'fr'],
    deck: async (handle, deckId) => {
      calls.push(`deck:${handle}/${deckId}`)
      return decks[`${handle}/${deckId}`] ?? null
    },
    editions: async () => [edition('zh', ['zh']), edition('en', ['en-GB']), edition('fr', ['fr'])],
    preview: async (_deck, code) => (code === 'en' ? preview : null),
  }
  const deps: CatalogueDeps = { store, origin: 'https://hub.test' }
  return { deps, calls }
}

void test('catalogue: 20 per page, query folded, language checked, edition of the visitor', async () => {
  const { deps, calls } = fakeStore({})
  const result = await catalogue(deps, {
    q: '  Verbes IRRÉGULIERS ',
    lang: 'FR',
    page: '3',
    locale: 'fr',
  })
  assert.deepEqual(calls, [
    `search:${JSON.stringify({ query: 'verbes irreguliers', language: 'fr', offset: 40, limit: 20 })}`,
  ])
  assert.equal(result.page, 3)
  assert.equal(result.pageCount, 3)
  assert.equal(result.total, 41)
  assert.deepEqual(result.languages, ['en', 'fr'])
  const card = present(result.decks[0])
  // The French visitor sees the French edition's name, description and languages.
  assert.deepEqual(
    { name: card.name, description: card.description, languages: card.languages },
    { name: 'Verbes', description: 'Français', languages: ['fr', 'en'] },
  )
  assert.deepEqual(card.editions, ['en', 'fr'])
  assert.equal(card.href, '/fr/d/alice/verbs')

  const english = await catalogue(deps, {
    q: undefined,
    lang: 'x"; drop',
    page: 'abc',
    locale: 'en',
  })
  assert.equal(english.page, 1)
  assert.equal(english.language, '')
  assert.equal(present(english.decks[0]).name, 'Verbs')
  assert.match(present(calls.at(-1)), /"query":"","language":"","offset":0/)
})

void test('default edition: the visitor’s language, otherwise the first by code', () => {
  const editions = [edition('zh', ['zh']), edition('en', ['en-GB']), edition('bi', ['fr', 'de'])]
  assert.equal(defaultEdition(editions, 'en')?.code, 'en')
  assert.equal(defaultEdition(editions, 'fr')?.code, 'bi')
  assert.equal(defaultEdition([edition('zh', ['zh']), edition('ja', ['ja'])], 'fr')?.code, 'ja')
  assert.equal(defaultEdition([], 'fr'), null)
})

void test('deck page: approved for all, pending for its author only, hidden is gone', async () => {
  const { deps } = fakeStore({
    'alice/verbs': { id: 1, status: 'approved', customerId: 7 },
    'alice/wip': { id: 2, status: 'pending', customerId: 7 },
    'alice/old': { id: 3, status: 'hidden', customerId: 7 },
  })
  const anonymous = async () => null
  const page = await deckPage(deps, {
    handle: 'alice',
    deckId: 'verbs',
    edition: undefined,
    locale: 'en',
    viewer: anonymous,
  })
  assert.equal(page.kind, 'found')
  assert.equal(page.edition.code, 'en')
  assert.deepEqual(
    page.editions.map((e) => e.code),
    ['en', 'fr', 'zh'],
  )
  assert.equal(page.address('en'), 'https://hub.test/d/alice/verbs/en/')
  assert.equal(page.status, 'approved')
  // An edition chosen by the address, and an unknown one falls back to the default.
  const fr = await deckPage(deps, {
    handle: 'alice',
    deckId: 'verbs',
    edition: 'fr',
    locale: 'en',
    viewer: anonymous,
  })
  assert.equal(fr.kind === 'found' && fr.edition.code, 'fr')
  const unknown = await deckPage(deps, {
    handle: 'alice',
    deckId: 'verbs',
    edition: 'xx',
    locale: 'fr',
    viewer: anonymous,
  })
  assert.equal(unknown.kind === 'found' && unknown.edition.code, 'fr')

  const pending = { handle: 'alice', deckId: 'wip', edition: undefined, locale: 'fr' as const }
  assert.equal((await deckPage(deps, { ...pending, viewer: anonymous })).kind, 'missing')
  assert.equal((await deckPage(deps, { ...pending, viewer: async () => 8 })).kind, 'missing')
  assert.equal((await deckPage(deps, { ...pending, viewer: async () => 7 })).kind, 'found')
  const hidden = { handle: 'alice', deckId: 'old', edition: undefined, locale: 'fr' as const }
  assert.equal((await deckPage(deps, { ...hidden, viewer: async () => 7 })).kind, 'gone')
  for (const [handle, deckId] of [
    ['Alice', 'verbs'],
    ['alice', 'Verbs'],
    ['nobody', 'verbs'],
  ] as const)
    assert.equal(
      (
        await deckPage(deps, {
          handle,
          deckId,
          edition: undefined,
          locale: 'fr',
          viewer: anonymous,
        })
      ).kind,
      'missing',
    )
})

void test('preview card: an approved deck’s card in its document, public; others not found', async () => {
  const { deps } = fakeStore({
    'alice/verbs': { id: 1, status: 'approved', customerId: 7 },
    'alice/wip': { id: 2, status: 'pending', customerId: 7 },
    'alice/old': { id: 3, status: 'hidden', customerId: 7 },
  })
  const anonymous = async () => null
  const card = await previewCard(deps, {
    handle: 'alice',
    deckId: 'verbs',
    edition: 'en',
    index: '0',
    side: 'back',
    viewer: anonymous,
  })
  assert.equal(card.kind, 'card')
  assert.equal(card.public, true)
  assert.ok(
    card.html.includes(
      '<div><img src="https://hub.test/d/alice/verbs/en/media/a.png"></div><hr id=answer>b',
    ),
  )
  assert.equal(card.csp, previewCSP(MEDIA_BASE))
  assert.ok(card.html.includes(previewMetaCSP(MEDIA_BASE)))
  const base = {
    handle: 'alice',
    deckId: 'verbs',
    edition: 'en',
    index: '0',
    side: 'front',
    viewer: anonymous,
  }
  for (const wrong of [
    { index: '2' },
    { index: '-1' },
    { index: '01' },
    { side: 'middle' },
    { edition: 'fr' },
    { edition: '..' },
    { deckId: 'old' },
    { deckId: 'wip' },
    { handle: 'ALICE' },
  ])
    assert.equal(
      (await previewCard(deps, { ...base, ...wrong })).kind,
      'missing',
      JSON.stringify(wrong),
    )
  const own = await previewCard(deps, { ...base, deckId: 'wip', viewer: async () => 7 })
  // The pending deck's author sees its preview, never cached publicly.
  assert.equal(own.kind, 'card')
  assert.equal(own.public, false)
})

void test('deck gone: only a hidden deck reads as withdrawn', async () => {
  const { deps } = fakeStore({
    'alice/verbs': { id: 1, status: 'approved', customerId: 7 },
    'alice/wip': { id: 2, status: 'pending', customerId: 7 },
    'alice/old': { id: 3, status: 'hidden', customerId: 7 },
  })
  assert.equal(await deckGone(deps, { handle: 'alice', deckId: 'old' }), true)
  for (const deckId of ['verbs', 'wip', 'none'])
    assert.equal(await deckGone(deps, { handle: 'alice', deckId }), false, deckId)
})

void test('robots.txt: the add-on files and the card previews are never crawled', async () => {
  const env = process.env as Record<string, string | undefined>
  const previous = env['PUBLIC_INDEXING']
  env['PUBLIC_INDEXING'] = 'true'
  try {
    const { default: robots } = await import('../src/app/robots')
    const rules = robots().rules
    const disallow = (Array.isArray(rules) ? rules[0] : rules)?.disallow
    assert.ok(Array.isArray(disallow))
    assert.ok(disallow.includes('/d/') && disallow.includes('/preview/'))
    assert.ok(!disallow.some((path) => path.includes('/decks')), 'the catalogue stays indexable')
  } finally {
    if (previous === undefined) delete env['PUBLIC_INDEXING']
    else env['PUBLIC_INDEXING'] = previous
  }
})

void test('markdown: pathological 200 KB inputs parse in linear time', () => {
  const size = 200_000
  const inputs = [
    '[a '.repeat(size / 3),
    '[a](b '.repeat(size / 6),
    '[a]('.repeat(size / 4),
    '**a '.repeat(size / 4),
    '__a '.repeat(size / 4),
    '*a '.repeat(size / 3),
    '_a '.repeat(size / 3),
    '`a '.repeat(size / 3),
    '*'.repeat(size),
    '[['.repeat(size / 2) + ']',
    `# ${' '.repeat(size)}x`,
    `- ${' '.repeat(size)}x`,
    '> '.repeat(size / 2),
  ]
  for (const input of inputs) {
    const start = performance.now()
    const blocks = parseMarkdown(input)
    const elapsed = performance.now() - start
    assert.ok(elapsed < 200, `${JSON.stringify(input.slice(0, 8))}: ${elapsed.toFixed(0)} ms`)
    assert.ok(blocks.length >= 1)
  }
  // Text without a construct comes back whole.
  const plain = '[a '.repeat(500)
  assert.equal(markdownText(plain), plain.trim())
  // Nesting stays readable past its depth limit, as text.
  assert.equal(markdownText('**a *b [c](https://x.test) d* e**'), 'a b c d e')
})

void test('markdown: descriptions are capped for summaries and for the deck page', () => {
  assert.equal(MAX_SUMMARY_SOURCE_CHARS, 2_000)
  assert.equal(MAX_DESCRIPTION_CHARS, 20_000)
  assert.ok(markdownText('word '.repeat(10_000)).length <= MAX_SUMMARY_SOURCE_CHARS)
  assert.deepEqual(truncateDescription('short'), { text: 'short', truncated: false })
  const long = truncateDescription('x'.repeat(30_000))
  assert.equal(long.truncated, true)
  assert.equal(long.text.length, MAX_DESCRIPTION_CHARS)
})
