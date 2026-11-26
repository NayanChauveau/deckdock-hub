import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react/pure'
import { HandleForm } from '../src/modules/decks/ui/HandleForm'
import { NewDeckForm } from '../src/modules/decks/ui/NewDeckForm'
import { TokenPanel } from '../src/modules/decks/ui/TokenPanel'
import { DeckEditions } from '../src/modules/decks/ui/DeckEditions'
import { deckMessages } from '../src/modules/decks/messages'
import type { DeckId } from '../src/modules/decks/domain/handle'
import type { Deck } from '../src/modules/decks/domain/model'
import { summarizeDeck } from '../src/modules/decks/application/author-space'
import { AuthorDecksView } from '../src/modules/decks/ui/AuthorDecksView'
import { AuthorDeckView } from '../src/modules/decks/ui/AuthorDeckView'
import { AuthorShell } from '../src/modules/decks/ui/AuthorShell'

const TOKEN = `ddk_${'A'.repeat(43)}`
afterEach(() => {
  cleanup()
})

/** Records what the page would copy (jsdom has no clipboard). */
function recordClipboard() {
  const copied: string[] = []
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        copied.push(text)
      },
    },
  })
  return copied
}

void test('the handle form shows why a handle is refused, under the field', async () => {
  const t = deckMessages.fr.space
  const sent: string[] = []
  let answer: Awaited<ReturnType<Parameters<typeof HandleForm>[0]['choose']>> = {
    ok: false,
    error: 'invalid_handle',
  }
  render(
    <HandleForm
      locale="fr"
      choose={async (handle) => {
        sent.push(handle)
        return answer
      }}
    />,
  )
  const field = screen.getByLabelText(t.handleLabel)
  fireEvent.change(field, { target: { value: 'A!' } })
  fireEvent.click(screen.getByRole('button', { name: t.handleSubmit }))
  assert.ok(await screen.findByText(t.handleErrors.invalid_handle))
  assert.equal(field.getAttribute('aria-invalid'), 'true')

  answer = { ok: false, error: 'handle_taken' }
  fireEvent.change(field, { target: { value: 'alice' } })
  fireEvent.click(screen.getByRole('button', { name: t.handleSubmit }))
  assert.ok(await screen.findByText(t.handleErrors.handle_taken))
  assert.equal(screen.queryByText(t.handleErrors.invalid_handle), null)
  assert.deepEqual(sent, ['A!', 'alice'])

  answer = { ok: true }
  fireEvent.click(screen.getByRole('button', { name: t.handleSubmit }))
  // The busy label comes back to the submit label once the answer is in.
  assert.ok(await screen.findByRole('button', { name: t.handleSubmit }))
  assert.equal(sent.length, 3)
  assert.equal(screen.queryByText(t.handleErrors.handle_taken), null)
  assert.equal(field.getAttribute('aria-invalid'), null)
})

void test('the handle form refuses an empty handle without a request (English)', () => {
  const t = deckMessages.en.space
  let calls = 0
  render(
    <HandleForm
      locale="en"
      choose={async () => {
        calls++
        return { ok: true }
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: t.handleSubmit }))
  assert.ok(screen.getByText(t.handleErrors.invalid_handle))
  assert.equal(calls, 0)
})

void test('a new deck shows its token once, with Copy, then hides it for good', async () => {
  const t = deckMessages.fr
  const copied = recordClipboard()
  const created: string[] = []
  render(
    <NewDeckForm
      locale="fr"
      create={async (deckId) => {
        created.push(deckId)
        if (deckId === 'verbs') return { ok: true, deckId, token: TOKEN }
        return { ok: false, error: deckId === 'eleventh' ? 'deck_limit' : 'deck_exists' }
      }}
    />,
  )
  const field = screen.getByLabelText(t.space.deckIdLabel)
  fireEvent.change(field, { target: { value: 'eleventh' } })
  fireEvent.click(screen.getByRole('button', { name: t.space.newSubmit }))
  assert.ok(await screen.findByText(t.space.createErrors.deck_limit))
  assert.match(t.space.createErrors.deck_limit, /10 decks/)
  fireEvent.change(field, { target: { value: 'kanji' } })
  fireEvent.click(screen.getByRole('button', { name: t.space.newSubmit }))
  assert.ok(await screen.findByText(t.space.createErrors.deck_exists))

  fireEvent.change(field, { target: { value: 'verbs' } })
  fireEvent.click(screen.getByRole('button', { name: t.space.newSubmit }))
  const shown = await screen.findByLabelText(t.token.label)
  assert.equal((shown as HTMLInputElement).value, TOKEN)
  assert.ok(screen.getByText(t.token.warning))
  assert.equal(
    screen.getByRole('link', { name: t.space.openDeck }).getAttribute('href'),
    '/fr/compte/decks/verbs',
  )
  fireEvent.click(screen.getByRole('button', { name: t.token.copy }))
  await screen.findByText(t.token.copied)
  assert.deepEqual(copied, [TOKEN])

  fireEvent.click(screen.getByRole('button', { name: t.token.hide }))
  assert.equal(screen.queryByLabelText(t.token.label), null)
  assert.ok(!document.body.innerHTML.includes(TOKEN), 'the token is gone from the page')
  assert.deepEqual(created, ['eleventh', 'kanji', 'verbs'])
})

void test('regenerating and revoking a token ask for confirmation first', async () => {
  const t = deckMessages.en.token
  const calls: string[] = []
  render(
    <TokenPanel
      locale="en"
      deckId="verbs"
      regenerate={async (deckId) => {
        calls.push(`regenerate ${deckId}`)
        return { ok: true, token: TOKEN }
      }}
      revoke={async (deckId) => {
        calls.push(`revoke ${deckId}`)
        return { ok: true }
      }}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: t.regenerate }))
  assert.ok(screen.getByText(t.regenerateQuestion))
  fireEvent.click(screen.getByRole('button', { name: t.cancel }))
  assert.deepEqual(calls, [], 'cancelled: nothing sent')

  fireEvent.click(screen.getByRole('button', { name: t.regenerate }))
  fireEvent.click(screen.getByRole('button', { name: t.regenerateConfirm }))
  const shown = await screen.findByLabelText(t.label)
  assert.equal((shown as HTMLInputElement).value, TOKEN)
  fireEvent.click(screen.getByRole('button', { name: t.hide }))
  assert.ok(!document.body.innerHTML.includes(TOKEN))

  fireEvent.click(screen.getByRole('button', { name: t.revoke }))
  assert.ok(screen.getByText(t.revokeQuestion))
  fireEvent.click(screen.getByRole('button', { name: t.revokeConfirm }))
  assert.equal((await screen.findByRole('status')).textContent, t.revoked)
  assert.deepEqual(calls, ['regenerate verbs', 'revoke verbs'])
})

void test('a failed token action says so and shows no token', async () => {
  const t = deckMessages.fr
  render(
    <TokenPanel
      locale="fr"
      deckId="verbs"
      regenerate={async () => ({ ok: false, error: 'unexpected' })}
      revoke={async () => ({ ok: false, error: 'signed_out' })}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: t.token.regenerate }))
  fireEvent.click(screen.getByRole('button', { name: t.token.regenerateConfirm }))
  assert.equal((await screen.findByRole('alert')).textContent, t.common.error)
  assert.equal(screen.queryByLabelText(t.token.label), null)
  fireEvent.click(screen.getByRole('button', { name: t.token.revoke }))
  fireEvent.click(screen.getByRole('button', { name: t.token.revokeConfirm }))
  await waitFor(() => {
    assert.equal(screen.getByRole('alert').textContent, t.common.signedOut)
  })
})

void test('during maintenance, an author action says so (English)', async () => {
  const t = deckMessages.en
  render(<HandleForm locale="en" choose={async () => ({ ok: false, error: 'maintenance' })} />)
  fireEvent.change(screen.getByRole('textbox', { name: t.space.handleLabel }), {
    target: { value: 'alice' },
  })
  fireEvent.click(screen.getByRole('button', { name: t.space.handleSubmit }))
  assert.equal((await screen.findByRole('alert')).textContent, t.common.maintenance)
})

void test('before the first version, the test address pattern keeps <edition> as written', () => {
  const t = deckMessages.fr.deck
  render(
    <DeckEditions
      locale="fr"
      origin="https://hub.example/"
      handle="alice"
      deckId="verbs"
      editions={[]}
    />,
  )
  assert.ok(screen.getByText(t.noEditions))
  assert.ok(screen.getByText('https://hub.example/d/alice/verbs/<edition>/'))
  assert.ok(!document.body.textContent.includes('%3C'))
})

void test('each edition shows its address and its versions, newest first', () => {
  const t = deckMessages.en.deck
  render(
    <DeckEditions
      locale="en"
      origin="https://hub.example"
      handle="alice"
      deckId="verbs"
      editions={[
        {
          code: 'en',
          versions: [
            { version: 'v2', receivedAt: new Date('2026-11-26T10:00:00Z'), notes: 12 },
            { version: 'v1', receivedAt: new Date('2026-11-25T10:00:00Z'), notes: 10 },
          ],
        },
      ]}
    />,
  )
  assert.ok(screen.getByText('https://hub.example/d/alice/verbs/en/'))
  const rows = screen.getAllByRole('row').slice(1)
  assert.deepEqual(
    rows.map((row) => row.textContent),
    ['26 Nov 2026, 11:00v212', '25 Nov 2026, 11:00v110'],
  )
  assert.ok(screen.getByRole('button', { name: t.copyAddress }))
})

const deck = (
  deckId: string,
  status: 'pending' | 'approved' | 'hidden',
  hiddenReason: string | null = null,
): Deck => ({
  id: deckId.length,
  authorId: 1,
  deckId: deckId as DeckId,
  status,
  approvedAt: null,
  hiddenReason,
  tokenLastUsedAt: null,
})
const edition = (
  code: string,
  overrides: Partial<Parameters<typeof summarizeDeck>[1][number]> = {},
) => ({
  code,
  name: `Name ${code}`,
  description: null,
  icon: null,
  languages: [code],
  notes: 10,
  version: '2026-11-20',
  receivedAt: new Date('2026-11-20T10:00:00Z'),
  ...overrides,
})

void test('a deck of the author space is named after the edition in the reader’s language', () => {
  const summary = summarizeDeck(
    deck('geo', 'approved'),
    [
      edition('fr', {
        name: 'Géographie',
        icon: '🗺️',
        version: 'v1',
        receivedAt: new Date('2026-11-20T10:00:00Z'),
      }),
      edition('en', {
        name: 'Geography',
        icon: null,
        version: 'v2',
        receivedAt: new Date('2026-11-24T10:00:00Z'),
      }),
    ],
    'fr',
  )
  assert.equal(summary.name, 'Géographie')
  assert.equal(summary.icon, '🗺️')
  assert.deepEqual(summary.editions, ['en', 'fr'])
  // The latest version received among its editions.
  assert.equal(summary.version, 'v2')
  // Only an English edition: a French reader sees it, never an empty name.
  const english = summarizeDeck(
    deck('geo', 'approved'),
    [edition('en', { name: 'Geography' })],
    'fr',
  )
  assert.equal(english.name, 'Geography')
  // No version yet: its identifier, and nothing else.
  const empty = summarizeDeck(deck('my-deck', 'pending'), [], 'fr')
  assert.deepEqual(
    { name: empty.name, icon: empty.icon, editions: empty.editions, version: empty.version },
    { name: 'my-deck', icon: null, editions: [], version: null },
  )
})

void test('the author space lists each deck: icon, identifier, editions, last version, status', () => {
  const t = deckMessages.fr
  render(
    <AuthorDecksView
      locale="fr"
      handle="alice"
      decks={[
        summarizeDeck(
          deck('geo-fr', 'approved'),
          [edition('fr', { name: 'Géographie', icon: '🗺️', version: '2026-11-24' }), edition('en')],
          'fr',
        ),
        summarizeDeck(deck('my-deck', 'pending'), [], 'fr'),
        summarizeDeck(deck('old', 'hidden', 'Contenu en double'), [edition('fr')], 'fr'),
      ]}
      chooseHandle={async () => ({ ok: true })}
      createDeck={async () => ({ ok: false, error: 'deck_exists' })}
    />,
  )
  assert.ok(screen.getByRole('heading', { level: 1, name: t.space.title }))
  assert.ok(screen.getByText('alice'))
  const items = screen.getAllByRole('listitem')
  assert.equal(items.length, 3)
  const [geo, mine, old] = items as [HTMLElement, HTMLElement, HTMLElement]
  assert.equal(geo.querySelector('a')?.getAttribute('href'), '/fr/compte/decks/geo-fr')
  assert.equal(geo.querySelector('a')?.textContent, 'Géographie')
  assert.ok(geo.textContent.includes('🗺️'), 'its icon')
  assert.ok(geo.textContent.includes('geo-fr'))
  assert.ok(geo.textContent.includes('en, fr'))
  assert.ok(geo.textContent.includes(t.space.lastVersion('2026-11-24')))
  assert.ok(geo.textContent.includes(t.status.approved))
  // No version: the initial of its identifier, and « Aucune version reçue ».
  assert.equal(mine.querySelector('a')?.textContent, 'my-deck')
  assert.ok(mine.textContent.includes('M'))
  assert.ok(mine.textContent.includes(t.space.noVersion))
  assert.ok(mine.textContent.includes(t.status.pending))
  // Hidden: the reason is shown with the status.
  assert.ok(old.textContent.includes(t.status.hidden))
  assert.ok(old.textContent.includes('Contenu en double'))
  // « + Nouveau deck » leads to the form, which stays on the page.
  assert.equal(
    screen.getByRole('link', { name: t.space.newDeck }).getAttribute('href'),
    '#deck-new',
  )
  assert.ok(screen.getByRole('button', { name: t.space.newSubmit }))
  assert.equal(screen.queryByRole('button', { name: t.space.handleSubmit }), null)
})

void test('without a handle, the author space asks for it first (English)', () => {
  const t = deckMessages.en.space
  render(
    <AuthorDecksView
      locale="en"
      handle={null}
      decks={[]}
      chooseHandle={async () => ({ ok: true })}
      createDeck={async () => ({ ok: false, error: 'no_handle' })}
    />,
  )
  assert.ok(screen.getByRole('heading', { level: 2, name: t.handleTitle }))
  assert.ok(screen.getByRole('button', { name: t.handleSubmit }))
  assert.equal(screen.queryByRole('button', { name: t.newSubmit }), null)
  assert.equal(screen.queryByRole('list'), null)
})

void test('an author with no deck yet is told so', () => {
  render(
    <AuthorDecksView
      locale="fr"
      handle="alice"
      decks={[]}
      chooseHandle={async () => ({ ok: true })}
      createDeck={async () => ({ ok: false, error: 'deck_exists' })}
    />,
  )
  assert.ok(screen.getByText(deckMessages.fr.space.noDecks))
})

void test('the author space sidebar: my decks, account, author guide; the current page is marked', () => {
  const t = deckMessages.fr.space.nav
  render(
    <AuthorShell locale="fr" current="decks">
      <p>contenu</p>
    </AuthorShell>,
  )
  const nav = screen.getByRole('navigation', { name: deckMessages.fr.space.navLabel })
  const links = [...nav.querySelectorAll('a')].map((a) => [
    a.textContent,
    a.getAttribute('href'),
    a.getAttribute('aria-current'),
  ])
  assert.deepEqual(links, [
    [t.decks, '/fr/compte/decks', 'page'],
    [t.account, '/fr/compte', null],
    [t.guide, '/fr/guide', null],
  ])
  assert.ok(screen.getByText('contenu'))
})

const pendingDeck = deck('verbs', 'pending')
const authorDeckProps = {
  locale: 'fr' as const,
  origin: 'https://hub.example',
  handle: 'alice',
  regenerate: async () => ({ ok: true as const, token: TOKEN }),
  revoke: async () => ({ ok: true as const }),
}

void test('before any version, the deck page shows the 3-step guide with the hub address to copy', async () => {
  const t = deckMessages.fr
  const copied = recordClipboard()
  render(
    <AuthorDeckView
      {...authorDeckProps}
      deck={pendingDeck}
      summary={summarizeDeck(pendingDeck, [], 'fr')}
      editions={[]}
    />,
  )
  assert.ok(screen.getByRole('heading', { level: 1, name: 'verbs' }))
  assert.equal(screen.getByTestId('deck-status').textContent, t.status.pending)
  const guide = screen.getByRole('region', { name: t.deck.guideTitle })
  const steps = guide.querySelectorAll('ol > li')
  assert.equal(steps.length, 3)
  assert.ok(guide.textContent.includes('DECKDOCK_TOKEN'))
  assert.ok(guide.textContent.includes('DECKDOCK_HUB_URL'))
  assert.equal(screen.getByTestId('hub-url').textContent, 'https://hub.example')
  fireEvent.click(screen.getByRole('button', { name: t.token.copy }))
  await screen.findByText(t.token.copied)
  assert.deepEqual(copied, ['https://hub.example'])
  const full = screen.getByRole('link', { name: t.deck.guideLink })
  assert.equal(full.getAttribute('href'), '/fr/guide/publier-avec-github')
  // The token, its regeneration and its revocation are on the page too.
  assert.ok(screen.getByRole('button', { name: t.token.regenerate }))
  assert.ok(screen.getByRole('button', { name: t.token.revoke }))
  assert.ok(screen.getByText(t.deck.noEditions))
})

void test('once a version is received, the guide gives way to the versions and the CI reminder', () => {
  const t = deckMessages.en
  const hidden = deck('verbs', 'hidden', 'Duplicate content')
  render(
    <AuthorDeckView
      {...authorDeckProps}
      locale="en"
      deck={hidden}
      summary={summarizeDeck(hidden, [edition('en', { name: 'English verbs', icon: '🇬🇧' })], 'en')}
      editions={[
        {
          code: 'en',
          versions: [{ version: 'v1', receivedAt: new Date('2026-11-25T10:00:00Z'), notes: 10 }],
        },
      ]}
    />,
  )
  assert.ok(screen.getByRole('heading', { level: 1, name: 'English verbs' }))
  assert.equal(screen.queryByRole('region', { name: t.deck.guideTitle }), null)
  assert.equal(screen.getByTestId('deck-status').textContent, t.status.hidden)
  assert.ok(screen.getByText(/Duplicate content/))
  assert.ok(screen.getByText('https://hub.example/d/alice/verbs/en/'))
  assert.ok(screen.getByText('DECKDOCK_TOKEN', { exact: true }))
  assert.ok(screen.getByText('DECKDOCK_HUB_URL', { exact: true }))
  assert.ok(screen.getByRole('button', { name: t.token.regenerate }))
})
