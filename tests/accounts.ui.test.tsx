import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react/pure'
import { SignInForm } from '../src/modules/accounts/ui/SignInForm'
import { AccountView } from '../src/modules/accounts/ui/AccountView'
import { accountMessages } from '../src/modules/accounts/messages'

const originalFetch = globalThis.fetch
interface Call {
  url: string
  method: string
  body: unknown
}
/** Records the calls to /api/auth; `answer` gives the status of each one. */
function recordFetch(answer: (url: string) => number = () => 200) {
  const calls: Call[] = []
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
    calls.push({ url, method: init?.method ?? 'GET', body })
    return Promise.resolve(new Response('{}', { status: answer(url) }))
  }
  return calls
}
const posts = (calls: Call[]) => calls.filter((call) => call.method === 'POST')
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

void test('the sign-in form sends the address and shows the neutral message', async () => {
  const t = accountMessages.fr.signIn
  const calls = recordFetch()
  render(<SignInForm locale="fr" />)
  fireEvent.change(screen.getByLabelText(t.email), { target: { value: 'visitor@example.test' } })
  fireEvent.click(screen.getByRole('button', { name: t.submit }))
  assert.equal((await screen.findByRole('status')).textContent, t.sent)
  assert.deepEqual(posts(calls), [
    {
      url: '/api/auth/sign-in/magic-link',
      method: 'POST',
      body: { email: 'visitor@example.test', callbackURL: '/fr/compte' },
    },
  ])
})

void test('the sign-in form refuses an invalid address without a request', () => {
  const t = accountMessages.en.signIn
  const calls = recordFetch()
  render(<SignInForm locale="en" />)
  fireEvent.change(screen.getByLabelText(t.email), { target: { value: 'nobody' } })
  fireEvent.click(screen.getByRole('button', { name: t.submit }))
  assert.ok(screen.getByText(t.invalidEmail))
  assert.equal(screen.getByLabelText(t.email).getAttribute('aria-invalid'), 'true')
  assert.deepEqual(calls, [])
})

void test('the sign-in form tells a refused or failed request apart from the neutral message', async () => {
  const t = accountMessages.en.signIn
  let status = 429
  recordFetch(() => status)
  render(<SignInForm locale="en" />)
  fireEvent.change(screen.getByLabelText(t.email), { target: { value: 'visitor@example.test' } })
  fireEvent.click(screen.getByRole('button', { name: t.submit }))
  assert.equal((await screen.findByRole('alert')).textContent, t.tooMany)
  status = 500
  fireEvent.click(screen.getByRole('button', { name: t.submit }))
  await waitFor(() => {
    assert.equal(screen.getByRole('alert').textContent, t.error)
  })
})

void test('my account shows the address and the three actions', () => {
  const t = accountMessages.fr.account
  recordFetch()
  render(<AccountView locale="fr" email="visitor@example.test" />)
  assert.ok(screen.getByRole('heading', { level: 1, name: t.title }))
  assert.ok(screen.getByText('visitor@example.test'))
  assert.ok(screen.getByRole('button', { name: t.signOut }))
  assert.ok(screen.getByRole('button', { name: t.signOutEverywhere }))
  assert.ok(screen.getByRole('button', { name: t.deleteStart }))
})

void test('signing out, here or everywhere, then goes to the sign-in page', async () => {
  const t = accountMessages.en.account
  for (const [label, path] of [
    [t.signOut, '/api/auth/sign-out'],
    [t.signOutEverywhere, '/api/auth/revoke-sessions'],
  ] as const) {
    const calls = recordFetch()
    const visited: string[] = []
    render(
      <AccountView
        locale="en"
        email="visitor@example.test"
        navigate={(url) => visited.push(url)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => {
      assert.deepEqual(visited, ['/en/compte/connexion'])
    })
    assert.deepEqual(
      posts(calls).map((call) => call.url),
      [path],
    )
    cleanup()
  }
})

void test('deletion asks for a confirmation before the email, and can be cancelled', async () => {
  const t = accountMessages.fr.account
  const calls = recordFetch()
  render(<AccountView locale="fr" email="visitor@example.test" navigate={() => assert.fail()} />)
  fireEvent.click(screen.getByRole('button', { name: t.deleteStart }))
  assert.ok(screen.getByText(t.deleteConfirmQuestion))
  assert.deepEqual(posts(calls), [], 'nothing is sent before the confirmation')
  fireEvent.click(screen.getByRole('button', { name: t.deleteCancel }))
  assert.equal(screen.queryByText(t.deleteConfirmQuestion), null)
  fireEvent.click(screen.getByRole('button', { name: t.deleteStart }))
  fireEvent.click(screen.getByRole('button', { name: t.deleteConfirm }))
  assert.equal(
    (await screen.findByRole('status')).textContent,
    t.deletionSent('visitor@example.test'),
  )
  assert.deepEqual(posts(calls), [
    { url: '/api/auth/delete-user', method: 'POST', body: { callbackURL: '/fr/compte' } },
  ])
})

void test('a failed account action stays on the page with an error', async () => {
  const t = accountMessages.en.account
  recordFetch((url) => (url.endsWith('/get-session') ? 200 : 503))
  render(<AccountView locale="en" email="visitor@example.test" navigate={() => assert.fail()} />)
  fireEvent.click(screen.getByRole('button', { name: t.signOut }))
  assert.equal((await screen.findByRole('alert')).textContent, t.error)
})

void test('a deletion link that did not work is explained on my account', () => {
  const t = accountMessages.fr.account
  recordFetch()
  render(<AccountView locale="fr" email="visitor@example.test" linkError="deletion_link" />)
  assert.equal(screen.getByRole('alert').textContent, t.deletionLinkError)
})

void test('a deletion link refused by the rate limit says so, not that it expired (M13)', () => {
  recordFetch()
  render(<AccountView locale="en" email="visitor@example.test" linkError="too_many" />)
  assert.equal(screen.getByRole('alert').textContent, accountMessages.en.signIn.tooMany)
})

void test('my account links to the pages other modules add', () => {
  const t = accountMessages.en.account
  recordFetch()
  render(
    <AccountView
      locale="en"
      email="visitor@example.test"
      links={[{ href: '/en/compte/decks', label: 'My decks' }]}
    />,
  )
  const nav = screen.getByRole('navigation', { name: t.linksLabel })
  assert.equal(nav.querySelector('a')?.getAttribute('href'), '/en/compte/decks')
  assert.ok(screen.getByRole('link', { name: 'My decks' }))
})
