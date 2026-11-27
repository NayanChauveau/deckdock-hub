import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, render, screen, within } from '@testing-library/react/pure'
import type { CatalogueCard, CataloguePage } from '../src/modules/decks/application/catalogue'
import { catalogueMessages } from '../src/modules/decks/catalogue-messages'
import { CatalogueView } from '../src/modules/decks/ui/CatalogueView'
import { CatalogueDeckCard } from '../src/modules/decks/ui/components/CatalogueDeckCard'
import { DeckCard } from '../src/modules/decks/ui/components/DeckCard'
import { relativeTime } from '../src/modules/decks/ui/format'
import { present } from './support/present'

// The catalogue's markup, drawn from a use case result (CatalogueView): the server page only reads
// the request and the database (tests/decks.catalogue.http.ts, tests/e2e/decks-catalogue.spec.ts).

afterEach(() => {
  cleanup()
})

const NOW = new Date('2026-11-26T12:00:00Z')
const t = catalogueMessages.fr.catalogue

const card = (over: Partial<CatalogueCard> = {}): CatalogueCard => ({
  handle: 'alice',
  deckId: 'verbes',
  href: '/fr/d/alice/verbes',
  name: 'Verbes irréguliers',
  description: 'Les verbes **irréguliers**, été comme hiver.',
  icon: '📘',
  languages: ['fr'],
  editions: ['en', 'fr'],
  notes: 80,
  updatedAt: new Date('2026-11-24T11:00:00Z'),
  ...over,
})

const page = (over: Partial<CataloguePage> = {}): CataloguePage => ({
  query: '',
  language: '',
  sort: 'updated',
  page: 1,
  pageCount: 1,
  total: 1,
  languages: ['en', 'fr'],
  decks: [card()],
  ...over,
})

void test('relative time: « il y a 2 j » / « 2 days ago », minutes to years, now under a minute', () => {
  // Intl puts no-break spaces between the number and its unit: compared as plain spaces.
  const ago = (ms: number, locale: 'fr' | 'en' = 'fr') =>
    relativeTime(locale, new Date(NOW.getTime() - ms), NOW)?.replace(/\s/g, ' ') ?? null
  const minute = 60_000
  const day = 24 * 60 * minute
  assert.equal(ago(2 * day), 'il y a 2 j')
  assert.equal(ago(2 * day, 'en'), '2 days ago')
  assert.equal(ago(5 * minute), 'il y a 5 min')
  assert.equal(ago(3 * 60 * minute), 'il y a 3 h')
  assert.equal(ago(21 * day), 'il y a 3 sem.')
  assert.equal(ago(60 * day), 'il y a 2 mois')
  assert.equal(ago(60 * day, 'en'), '2 months ago')
  assert.equal(ago(400 * day), 'il y a 1 an')
  // Under a minute, or a clock slightly ahead: no number at all.
  assert.equal(ago(20_000), null)
  assert.equal(ago(-5 * minute), null)
})

void test('DeckCard: one link whose accessible name is the deck name, pills under it', () => {
  const { container } = render(
    <DeckCard
      href="/fr/d/alice/verbes"
      deckId="verbes"
      name="Verbes irréguliers"
      description="Les verbes irréguliers."
      icon="📘"
      languages={['fr', 'en']}
      pills={['80 notes', 'il y a 2 j']}
      meta="par alice"
    />,
  )
  const links = screen.getAllByRole('link')
  assert.equal(links.length, 1)
  const link = screen.getByRole('link', { name: 'Verbes irréguliers' })
  assert.equal(link.getAttribute('href'), '/fr/d/alice/verbes')
  // The rest of the card is its description for assistive technologies.
  const describedBy = link.getAttribute('aria-describedby') ?? ''
  const description = describedBy
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
  assert.match(description, /Les verbes irréguliers\./)
  assert.match(description, /80 notes/)
  assert.match(description, /par alice/)
  // The link holds the name only (its visible text is its name); the card around it shows the rest.
  assert.equal(link.textContent, 'Verbes irréguliers')
  const cardElement = container.firstElementChild as HTMLElement
  for (const pill of ['fr', 'en', '80 notes', 'il y a 2 j', 'par alice'])
    assert.ok(within(cardElement).getByText(pill), pill)
})

void test('CatalogueDeckCard (catalogue and home): languages, notes, relative time and author', () => {
  render(<CatalogueDeckCard locale="fr" deck={card()} now={NOW} />)
  const description = (
    screen.getByRole('link', { name: 'Verbes irréguliers' }).getAttribute('aria-describedby') ?? ''
  )
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .replace(/\s/g, ' ')
  assert.match(description, /80 notes/)
  assert.match(description, /il y a 2 j/)
  assert.match(description, /par alice/)
})

void test('catalogue: big search, language pills as links keeping q and sort, sort select', () => {
  render(
    <CatalogueView
      locale="fr"
      result={page({ query: 'verbes', sort: 'name', language: 'en' })}
      now={NOW}
    />,
  )
  assert.ok(screen.getByRole('heading', { level: 1, name: t.title }))
  const search = screen.getByRole('search')
  assert.equal(search.getAttribute('method'), 'get')
  assert.equal(search.getAttribute('action'), '/fr/decks')
  const box = within(search).getByRole('searchbox', { name: t.searchLabel })
  assert.equal((box as HTMLInputElement).value, 'verbes')
  assert.ok(within(search).getByRole('button', { name: t.submit }))
  // The language filter keeps working without JavaScript: the form carries it as a hidden field.
  const hidden = search.querySelector<HTMLInputElement>('input[type="hidden"][name="lang"]')
  assert.equal(hidden?.value, 'en')

  const sort = within(search).getByRole<HTMLSelectElement>('combobox', { name: t.sortLabel })
  assert.equal(sort.name, 'sort')
  assert.equal(sort.value, 'name')
  assert.deepEqual(
    [...sort.options].map((option) => [option.value, option.textContent]),
    [
      ['updated', t.sorts.updated],
      ['name', t.sorts.name],
      ['notes', t.sorts.notes],
    ],
  )

  const filters = screen.getByRole('navigation', { name: t.languageFilter })
  const pills = within(filters).getAllByRole('link')
  assert.deepEqual(
    pills.map((pill) => pill.textContent),
    [t.anyLanguage, 'English', 'Français'],
  )
  assert.deepEqual(
    pills.map((pill) => pill.getAttribute('href')),
    [
      '/fr/decks?q=verbes&sort=name',
      '/fr/decks?q=verbes&lang=en&sort=name',
      '/fr/decks?q=verbes&lang=fr&sort=name',
    ],
  )
  // The language's own name, marked with its language; the active pill says so.
  assert.deepEqual(
    pills.map((pill) => [pill.getAttribute('lang'), pill.getAttribute('aria-current')]),
    [
      [null, null],
      ['en', 'page'],
      ['fr', null],
    ],
  )
})

void test('catalogue: « Toutes les langues » is the active pill without a filter', () => {
  render(<CatalogueView locale="en" result={page()} now={NOW} />)
  const en = catalogueMessages.en.catalogue
  const pills = within(screen.getByRole('navigation', { name: en.languageFilter })).getAllByRole(
    'link',
  )
  assert.deepEqual(
    pills.map((pill) => [
      pill.textContent,
      pill.getAttribute('href'),
      pill.getAttribute('aria-current'),
    ]),
    [
      [en.anyLanguage, '/en/decks', 'page'],
      ['English', '/en/decks?lang=en', null],
      ['Français', '/en/decks?lang=fr', null],
    ],
  )
})

void test('catalogue: a grid of whole-card links with languages, notes, update and author', () => {
  render(
    <CatalogueView
      locale="fr"
      result={page({
        total: 2,
        decks: [
          card(),
          card({ deckId: 'autre', href: '/fr/d/alice/autre', name: 'Autre', notes: 1 }),
        ],
      })}
      now={NOW}
    />,
  )
  assert.equal(screen.getByTestId('catalogue-total').textContent, t.results(2))
  const results = screen.getByRole('region', { name: t.results(2) })
  const items = within(results).getAllByRole('listitem')
  assert.equal(items.length, 2)
  for (const item of items) assert.equal(within(item).getAllByRole('link').length, 1)
  const first = within(results).getByRole('link', { name: 'Verbes irréguliers' })
  assert.equal(first.getAttribute('href'), '/fr/d/alice/verbes')
  // Pills: the shown edition's languages, its notes, the relative update; then the author.
  const firstItem = present(items[0])
  assert.ok(firstItem.contains(first))
  for (const text of ['fr', '80 notes', 'il y a 2 j', 'par alice'])
    assert.ok(within(firstItem).getByText(text), text)
  // Description as plain text (no Markdown marks).
  assert.ok(within(firstItem).getByText('Les verbes irréguliers, été comme hiver.'))
  assert.ok(within(results).getByText('1 note'))
  // One page: no pagination.
  assert.equal(screen.queryByRole('navigation', { name: t.pagination }), null)
})

void test('catalogue: pagination keeps the search, the language and the sort', () => {
  render(
    <CatalogueView
      locale="fr"
      result={page({
        query: 'a b',
        language: 'fr',
        sort: 'notes',
        page: 2,
        pageCount: 3,
        total: 41,
      })}
      now={NOW}
    />,
  )
  const nav = screen.getByRole('navigation', { name: t.pagination })
  assert.equal(
    within(nav).getByRole('link', { name: t.previous }).getAttribute('href'),
    '/fr/decks?q=a+b&lang=fr&sort=notes',
  )
  assert.equal(
    within(nav).getByRole('link', { name: t.next }).getAttribute('href'),
    '/fr/decks?q=a+b&lang=fr&sort=notes&page=3',
  )
  assert.ok(within(nav).getByText(t.pageOf(2, 3)))
})

void test('catalogue: no deck at all invites authors to publish the first one', () => {
  render(
    <CatalogueView
      locale="fr"
      result={page({ total: 0, pageCount: 0, decks: [], languages: [] })}
      now={NOW}
    />,
  )
  assert.ok(screen.getByRole('heading', { level: 2, name: t.emptyCatalogue }))
  assert.ok(screen.getByText(t.emptyCatalogueText))
  assert.equal(
    screen.getByRole('link', { name: t.publishFirst }).getAttribute('href'),
    '/fr/compte/decks',
  )
  assert.equal(screen.queryByRole('list'), null)
})

void test('catalogue: a search without result says so and offers to clear it', () => {
  render(
    <CatalogueView
      locale="fr"
      result={page({ query: 'zzzz', language: 'de', total: 0, pageCount: 0, decks: [] })}
      now={NOW}
    />,
  )
  assert.equal(screen.getByTestId('catalogue-total').textContent, t.results(0))
  assert.ok(screen.getByText(t.noResultText))
  assert.equal(screen.getByRole('link', { name: t.clear }).getAttribute('href'), '/fr/decks')
})

void test('catalogue: a page past the last one is empty, with a way back to the first', () => {
  render(
    <CatalogueView
      locale="en"
      result={page({ query: 'verbs', sort: 'name', page: 9, pageCount: 2, total: 25, decks: [] })}
      now={NOW}
    />,
  )
  const en = catalogueMessages.en.catalogue
  assert.equal(screen.getByTestId('catalogue-total').textContent, en.results(25))
  assert.ok(screen.getByText(en.beyondText(2)))
  assert.equal(
    screen.getByRole('link', { name: en.firstPage }).getAttribute('href'),
    '/en/decks?q=verbs&sort=name',
  )
})
