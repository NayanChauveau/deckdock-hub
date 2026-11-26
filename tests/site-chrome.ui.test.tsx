import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react/pure'
import { SiteFooter, SiteHeader } from '../src/site/SiteChrome'
import { messages } from '../src/site/messages'
import { viewerFrom, visitorCookies } from '../src/site/viewer'

const paths = { fr: '/fr/decks', en: '/en/decks' }
const originalFetch = globalThis.fetch
afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

const header = () => screen.getByRole('banner')
const link = (name: string | RegExp) => within(header()).getByRole('link', { name })

void test('the header links to the catalogue, publishing guide and guide, in the page language', () => {
  render(<SiteHeader locale="fr" paths={paths} viewer={{ signedIn: false }} />)
  assert.equal(link('Catalogue').getAttribute('href'), '/fr/decks')
  assert.equal(link('Publier un deck').getAttribute('href'), '/fr/guide/publier-avec-github')
  assert.equal(link('Guide').getAttribute('href'), '/fr/guide')
  assert.equal(link(/DeckDock/).getAttribute('href'), '/fr')
  cleanup()
  render(<SiteHeader locale="en" paths={paths} viewer={{ signedIn: false }} />)
  assert.equal(link('Catalogue').getAttribute('href'), '/en/decks')
  assert.equal(link('Publish a deck').getAttribute('href'), '/en/guide/publish-with-github')
  assert.equal(link('Guide').getAttribute('href'), '/en/guide')
})

void test('FR · EN point to the same page in each language, the current one marked', () => {
  render(
    <SiteHeader
      locale="en"
      paths={{ fr: '/fr/mentions-legales', en: '/en/legal-notice' }}
      viewer={{ signedIn: false }}
    />,
  )
  const fr = link(/^FR/)
  const en = link(/^EN/)
  assert.equal(fr.getAttribute('href'), '/fr/mentions-legales')
  assert.equal(fr.getAttribute('hreflang'), 'fr')
  assert.equal(fr.getAttribute('aria-current'), null)
  assert.equal(en.getAttribute('href'), '/en/legal-notice')
  assert.equal(en.getAttribute('aria-current'), 'page')
})

void test('the current section of the site is marked in the navigation', () => {
  render(<SiteHeader locale="fr" paths={paths} viewer={{ signedIn: false }} />)
  assert.equal(link('Catalogue').getAttribute('aria-current'), 'page')
  assert.equal(link('Guide').getAttribute('aria-current'), null)
})

void test('a visitor who is not signed in gets « Connexion »', () => {
  render(<SiteHeader locale="fr" paths={paths} viewer={{ signedIn: false }} />)
  assert.equal(link('Connexion').getAttribute('href'), '/fr/compte/connexion')
  assert.equal(within(header()).queryByRole('button', { name: /Compte/ }), null)
})

void test('a signed-in visitor without a handle gets the « Compte » menu', () => {
  render(<SiteHeader locale="fr" paths={paths} viewer={{ signedIn: true, handle: null }} />)
  assert.equal(within(header()).queryByRole('link', { name: 'Connexion' }), null)
  const menu = within(header()).getByRole('button', { name: /^Compte/ })
  assert.equal(menu.getAttribute('aria-expanded'), 'false')
  assert.equal(within(header()).queryByRole('link', { name: 'Mes decks' }), null)
  fireEvent.click(menu)
  assert.equal(menu.getAttribute('aria-expanded'), 'true')
  assert.equal(link('Mes decks').getAttribute('href'), '/fr/compte/decks')
  assert.equal(link('Compte').getAttribute('href'), '/fr/compte')
  assert.ok(within(header()).getByRole('button', { name: 'Déconnexion' }))
})

void test('a signed-in author gets a menu named after the handle; Escape closes it', () => {
  render(<SiteHeader locale="en" paths={paths} viewer={{ signedIn: true, handle: 'demo' }} />)
  const menu = within(header()).getByRole('button', { name: /^demo/ })
  fireEvent.click(menu)
  assert.equal(link('My decks').getAttribute('href'), '/en/compte/decks')
  assert.equal(link('Account').getAttribute('href'), '/en/compte')
  fireEvent.keyDown(menu, { key: 'Escape' })
  assert.equal(menu.getAttribute('aria-expanded'), 'false')
  assert.equal(within(header()).queryByRole('link', { name: 'My decks' }), null)
})

void test('signing out from the menu posts to Better Auth, then leaves for the homepage', async () => {
  const calls: string[] = []
  globalThis.fetch = (input, init) => {
    calls.push(`${init?.method ?? 'GET'} ${typeof input === 'string' ? input : 'other'}`)
    return Promise.resolve(new Response('{}', { status: 200 }))
  }
  const visited: string[] = []
  render(
    <SiteHeader
      locale="fr"
      paths={paths}
      viewer={{ signedIn: true, handle: 'demo' }}
      navigate={(url) => visited.push(url)}
    />,
  )
  fireEvent.click(within(header()).getByRole('button', { name: /^demo/ }))
  fireEvent.click(within(header()).getByRole('button', { name: 'Déconnexion' }))
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['POST /api/auth/sign-out'])
  assert.deepEqual(visited, ['/fr'])
})

void test('an unknown viewer (error page, maintenance) shows no account entry', () => {
  render(<SiteHeader locale="fr" paths={paths} viewer={null} />)
  assert.equal(within(header()).queryByRole('link', { name: 'Connexion' }), null)
  assert.equal(within(header()).queryByRole('button', { name: /Compte/ }), null)
})

void test('the mobile menu button opens the links in a column', () => {
  render(<SiteHeader locale="fr" paths={paths} viewer={{ signedIn: true, handle: 'demo' }} />)
  const button = within(header()).getByRole('button', { name: 'Menu' })
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  const panel = document.getElementById(button.getAttribute('aria-controls') ?? '')
  assert.ok(panel)
  assert.ok(panel.hidden)
  fireEvent.click(button)
  assert.equal(button.getAttribute('aria-expanded'), 'true')
  assert.equal(panel.hidden, false)
  const inPanel = within(panel)
  assert.equal(inPanel.getByRole('link', { name: 'Catalogue' }).getAttribute('href'), '/fr/decks')
  assert.equal(
    inPanel.getByRole('link', { name: 'Mes decks' }).getAttribute('href'),
    '/fr/compte/decks',
  )
  assert.ok(inPanel.getByRole('button', { name: 'Déconnexion' }))
  // A link followed from the panel closes it.
  fireEvent.click(inPanel.getByRole('link', { name: 'Guide' }))
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  fireEvent.click(button)
  fireEvent.keyDown(panel, { key: 'Escape' })
  assert.equal(button.getAttribute('aria-expanded'), 'false')
  assert.equal(document.activeElement, button)
})

void test('the footer: DeckDock · open source, GitHub repositories, guide and legal pages', () => {
  render(<SiteFooter locale="fr" />)
  const footer = within(screen.getByRole('contentinfo'))
  assert.ok(footer.getByText(/open source/))
  const hrefs = footer.getAllByRole('link').map((anchor) => anchor.getAttribute('href'))
  assert.deepEqual(hrefs, [
    'https://github.com/NayanChauveau/deckdock',
    'https://github.com/NayanChauveau/deckdock-hub',
    '/fr/guide',
    '/fr/mentions-legales',
    '/fr/confidentialite',
  ])
})

void test('no starter placeholder text is left in the site messages', () => {
  const all = JSON.stringify(messages)
  assert.ok(!/Site d’exemple|Example website|Site en préparation|Website in preparation/.test(all))
})

void test('the viewer: a visitor account, with the name a module gives it, or nobody', async () => {
  const names = (name: string | null) => () => Promise.resolve(name)
  assert.deepEqual(await viewerFrom(null, names('demo')), { signedIn: false })
  // An administrator is never a visitor (the accounts strategy's rule).
  assert.deepEqual(await viewerFrom({ collection: 'users', id: 1 }, names('demo')), {
    signedIn: false,
  })
  assert.deepEqual(await viewerFrom({ collection: 'customers', id: 7 }, names(null)), {
    signedIn: true,
    handle: null,
  })
  const asked: number[] = []
  const viewer = await viewerFrom({ collection: 'customers', id: 7 }, (id) => {
    asked.push(id)
    return Promise.resolve('demo')
  })
  assert.deepEqual(viewer, { signedIn: true, handle: 'demo' })
  assert.deepEqual(asked, [7])
})

void test('the header reads the visitor session even beside an administrator’s session', () => {
  // The administration's cookies (`payload-token`, `payload-totp`) are left out: the accounts
  // strategy then resolves the visitor, as the sign-in page's visitorSession does.
  assert.equal(
    visitorCookies(
      'payload-token=a; customer.session_token=b; payload-totp=c; theme=dark',
      'payload',
    ),
    'customer.session_token=b; theme=dark',
  )
  assert.equal(visitorCookies('customer.session_token=b', 'payload'), 'customer.session_token=b')
  assert.equal(visitorCookies('payload-token=a', 'payload'), '')
  // Another prefix, only its own cookies.
  assert.equal(visitorCookies('site-token=a; payload-token=b', 'site'), 'payload-token=b')
})
