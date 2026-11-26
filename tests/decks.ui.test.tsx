import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react/pure'
import { HandleForm } from '../src/modules/decks/ui/HandleForm'
import { NewDeckForm } from '../src/modules/decks/ui/NewDeckForm'
import { TokenPanel } from '../src/modules/decks/ui/TokenPanel'
import { DeckEditions } from '../src/modules/decks/ui/DeckEditions'
import { deckMessages } from '../src/modules/decks/messages'

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
        return deckId === 'verbs'
          ? { ok: true, deckId, token: TOKEN }
          : { ok: false, error: 'deck_exists' }
      }}
    />,
  )
  const field = screen.getByLabelText(t.space.deckIdLabel)
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
  assert.deepEqual(created, ['kanji', 'verbs'])
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
