import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react/pure'
import type { DeckPageResult, PublicEdition } from '../src/modules/decks/application/catalogue'
import { catalogueMessages } from '../src/modules/decks/catalogue-messages'
import { ADDON_URL, DeckView } from '../src/modules/decks/ui/DeckView'

// The deck page's markup, drawn from a use case result (DeckView): the server page only reads the
// request and the database (tests/decks.catalogue.http.ts, tests/e2e/decks-catalogue.spec.ts).

afterEach(() => {
  cleanup()
})

type Found = Extract<DeckPageResult, { kind: 'found' }>
const NOW = new Date('2026-11-26T12:00:00Z')
const t = catalogueMessages.fr.deck

const edition = (over: Partial<PublicEdition> = {}): PublicEdition => ({
  code: 'fr',
  name: 'Verbes irréguliers',
  description: 'Les verbes **irréguliers**.',
  icon: '📘',
  languages: ['fr'],
  license: 'CC-BY-4.0',
  homepage: 'https://github.com/alice/verbes',
  notes: 1240,
  version: 'v2',
  receivedAt: new Date('2026-11-24T12:00:00Z'),
  versions: [
    { version: 'v2', receivedAt: new Date('2026-11-24T12:00:00Z'), notes: 1240 },
    { version: 'v1', receivedAt: new Date('2026-11-10T12:00:00Z'), notes: 1228 },
  ],
  previews: 5,
  ...over,
})

function found(shown: Partial<PublicEdition> = {}, over: Partial<Found> = {}): Found {
  const fr = edition(shown)
  const en = edition({ code: 'en', name: 'Irregular verbs', languages: ['en'], icon: '📗' })
  return {
    kind: 'found',
    handle: 'alice',
    deckId: 'verbes',
    status: 'approved',
    icon: '📘',
    editions: [en, fr],
    edition: fr,
    address: (code) => `https://hub.test/d/alice/verbes/${code}/`,
    preview: (index, side) => `/preview/alice/verbes/${fr.code}/${index}/${side}`,
    ...over,
  }
}

void test('deck header: icon, name, author, licence and relative update', () => {
  render(<DeckView locale="fr" page={found()} now={NOW} />)
  const heading = screen.getByRole('heading', { level: 1, name: 'Verbes irréguliers' })
  const header = heading.closest('header')
  assert.ok(header, 'the deck header')
  assert.ok(within(header).getByText('📘'), 'the deck icon')
  const text = header.textContent.replace(/\s/g, ' ')
  for (const part of ['par alice', 'CC-BY-4.0', 'mis à jour il y a 2 j'])
    assert.ok(text.includes(part), `${part} in « ${text} »`)
  // Breadcrumb back to the catalogue.
  const crumbs = screen.getByRole('navigation', { name: t.breadcrumb })
  assert.equal(
    within(crumbs).getByRole('link', { name: t.catalogueCrumb }).getAttribute('href'),
    '/fr/decks',
  )
})

void test('follow block: a tab per edition, the address to copy, how to add it, the add-on', () => {
  render(<DeckView locale="fr" page={found()} now={NOW} />)
  const follow = screen.getByRole('region', { name: t.followTitle })
  const tabs = within(follow).getByRole('navigation', { name: t.editionsTitle })
  const links = within(tabs).getAllByRole('link')
  assert.deepEqual(
    links.map((link) => [link.textContent, link.getAttribute('href')]),
    [
      ['English', '/fr/d/alice/verbes?edition=en'],
      ['Français', '/fr/d/alice/verbes?edition=fr'],
    ],
  )
  assert.equal(
    within(tabs).getByRole('link', { name: 'Français' }).getAttribute('aria-current'),
    'page',
  )
  assert.equal(
    within(tabs).getByRole('link', { name: 'English' }).getAttribute('aria-current'),
    null,
  )
  // The shown edition's address only, with its Copy button.
  assert.equal(
    within(follow).getByTestId('address-fr').textContent,
    'https://hub.test/d/alice/verbes/fr/',
  )
  assert.equal(within(follow).queryByTestId('address-en'), null)
  assert.ok(within(follow).getByRole('button', { name: t.copy }))
  assert.ok(within(follow).getByText(t.followHow))
  const install = within(follow).getByRole('link', { name: new RegExp(t.installAddon) })
  assert.equal(install.getAttribute('href'), ADDON_URL)
  assert.equal(ADDON_URL, 'https://github.com/NayanChauveau/deckdock/tree/main/addon')
})

void test('facts: notes, languages, licence, Source for an https homepage only', () => {
  const { rerender } = render(<DeckView locale="fr" page={found()} now={NOW} />)
  const facts = () => screen.getByRole('region', { name: t.facts })
  const text = facts().textContent.replace(/\s/g, ' ')
  for (const part of ['Notes', '1 240', 'Langues', 'français', 'Licence', 'CC-BY-4.0'])
    assert.ok(text.includes(part), `${part} in « ${text} »`)
  const source = within(facts()).getByRole('link', { name: /github\.com/ })
  assert.equal(source.getAttribute('href'), 'https://github.com/alice/verbes')
  assert.ok(text.includes(t.source))
  for (const homepage of [
    'http://example.test/verbes',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'https//nope',
    null,
  ]) {
    rerender(<DeckView locale="fr" page={found({ homepage })} now={NOW} />)
    assert.ok(!facts().textContent.includes(t.source), String(homepage))
    assert.equal(within(facts()).queryAllByRole('link').length, 0, String(homepage))
    if (homepage) assert.ok(!document.body.innerHTML.includes(homepage.slice(0, 12)), homepage)
  }
})

void test('the follow block comes right after the deck header, before the preview', () => {
  render(<DeckView locale="fr" page={found()} now={NOW} />)
  const header = screen.getByRole('heading', { level: 1 }).closest('header')
  const follow = screen.getByRole('region', { name: t.followTitle })
  const preview = screen.getByRole('region', { name: t.previewTitle })
  assert.ok(header && header.compareDocumentPosition(follow) & Node.DOCUMENT_POSITION_FOLLOWING)
  assert.ok(follow.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING)
  // Nothing but the follow block between the header and it (the facts come after it).
  const order = [...document.querySelectorAll('header, section[aria-labelledby]')].map(
    (element) => element.tagName,
  )
  assert.equal(order[0], 'HEADER')
  assert.equal(
    document.querySelectorAll('section[aria-labelledby]')[0],
    follow,
    'the first section is the follow block',
  )
})

void test('preview carousel: one note at a time, front and back, previous and next', () => {
  render(<DeckView locale="fr" page={found()} now={NOW} />)
  const preview = screen.getByRole('region', { name: t.previewTitle })
  const frames = () =>
    [...preview.querySelectorAll('iframe')].map((frame) => ({
      src: frame.getAttribute('src'),
      sandbox: frame.getAttribute('sandbox'),
      title: frame.getAttribute('title'),
    }))
  assert.deepEqual(frames(), [
    { src: '/preview/alice/verbes/fr/0/front', sandbox: 'allow-scripts', title: 'Note 1, recto' },
    { src: '/preview/alice/verbes/fr/0/back', sandbox: 'allow-scripts', title: 'Note 1, verso' },
  ])
  const status = within(preview).getByRole('status')
  assert.equal(status.textContent, 'Note 1 sur 5')
  fireEvent.click(within(preview).getByRole('button', { name: t.nextNote }))
  assert.equal(status.textContent, 'Note 2 sur 5')
  assert.deepEqual(
    frames().map((frame) => frame.src),
    ['/preview/alice/verbes/fr/1/front', '/preview/alice/verbes/fr/1/back'],
  )
  for (const frame of frames()) assert.equal(frame.sandbox, 'allow-scripts')
  // Tall enough for a back side (front + answer) without scrolling in the frame, the same on both
  // sides: never the former 14 rem (`h-56`).
  const heights = [...preview.querySelectorAll('iframe')].map((frame) =>
    [...frame.classList].filter((name) => /^(sm:)?h-/.test(name)).join(' '),
  )
  assert.equal(heights[0], heights[1], 'front and back frames share one height')
  assert.ok(
    heights[0] && !heights[0].split(' ').includes('h-56'),
    `taller than h-56: ${heights[0]}`,
  )
  // Previous from the first note goes round to the last one.
  fireEvent.click(within(preview).getByRole('button', { name: t.previousNote }))
  fireEvent.click(within(preview).getByRole('button', { name: t.previousNote }))
  assert.equal(status.textContent, 'Note 5 sur 5')
  assert.equal(frames()[0]?.src, '/preview/alice/verbes/fr/4/front')
  fireEvent.click(within(preview).getByRole('button', { name: t.nextNote }))
  assert.equal(status.textContent, 'Note 1 sur 5')
})

void test('preview: a single note has no carousel buttons; none says so', () => {
  const { rerender } = render(<DeckView locale="fr" page={found({ previews: 1 })} now={NOW} />)
  const preview = () => screen.getByRole('region', { name: t.previewTitle })
  assert.equal(preview().querySelectorAll('iframe').length, 2)
  assert.equal(within(preview()).queryAllByRole('button').length, 0)
  rerender(<DeckView locale="fr" page={found({ previews: 0 })} now={NOW} />)
  assert.equal(preview().querySelectorAll('iframe').length, 0)
  assert.ok(within(preview()).getByText(t.noPreview))
})

void test('description, version history and the pending note', () => {
  render(<DeckView locale="fr" page={found({}, { status: 'pending' })} now={NOW} />)
  assert.ok(screen.getByRole('note').textContent.includes(t.pending))
  const description = screen.getByRole('region', { name: t.description })
  assert.equal(within(description).getByText('irréguliers').tagName, 'STRONG')
  const history = screen.getByRole('region', { name: t.historyTitle })
  const rows = within(history).getAllByRole('row').slice(1)
  assert.deepEqual(
    rows.map((row) => within(row).getAllByRole('cell')[1]?.textContent),
    ['v2', 'v1'],
  )
})

void test('English: texts in English, the English edition tab named in English', () => {
  const en = catalogueMessages.en.deck
  const page = found()
  render(
    <DeckView
      locale="en"
      page={{ ...page, edition: page.editions[0] ?? page.edition }}
      now={NOW}
    />,
  )
  assert.ok(screen.getByRole('heading', { level: 1, name: 'Irregular verbs' }))
  const follow = screen.getByRole('region', { name: en.followTitle })
  assert.ok(within(follow).getByText(en.followHow))
  assert.ok(screen.getByRole('region', { name: en.facts }))
  const header = screen.getByRole('heading', { level: 1 }).closest('header')
  assert.ok(header?.textContent.includes('updated 2 days ago'))
  assert.ok(
    screen.getByRole('region', { name: en.previewTitle }).textContent.includes('Note 1 of 5'),
  )
})
