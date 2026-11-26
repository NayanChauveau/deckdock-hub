import { expect, test, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { accountMessages } from '../../src/modules/accounts/messages'
import { deckMessages } from '../../src/modules/decks/messages'
import { CATALOGUE_SEED } from '../support/catalogue-seed'
import { deckJson, editionArchive } from '../support/deck-archive'
import {
  accessibilityViolations,
  guardEveryPage,
  pageErrors,
  pageOverflow,
  signInAdmin,
} from './support'

guardEveryPage()

/** The last sign-in link emailed to `to` (the development server's mailbox, set by tests/run.mjs). */
function lastSignInLink(to: string): string {
  const file = process.env['ACCOUNTS_TEST_MAILBOX']
  if (!file) throw new Error('ACCOUNTS_TEST_MAILBOX absent : lancer la suite avec pnpm test')
  const url = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; to: string; url: string })
    .filter((mail) => mail.to === to && mail.kind === 'signInEmail')
    .at(-1)?.url
  if (!url) throw new Error(`Aucun lien de connexion pour ${to}`)
  return url
}

/** Signs in by magic link, through the accounts module's own page. */
async function signIn(page: Page, locale: 'fr' | 'en', email: string) {
  const t = accountMessages[locale].signIn
  await page.goto(`/${locale}/compte/connexion`)
  await page.waitForLoadState('networkidle')
  await page.getByLabel(t.email).fill(email)
  await page.getByRole('button', { name: t.submit }).click()
  await expect(page.getByRole('main').getByRole('status')).toHaveText(t.sent)
  await page.goto(lastSignInLink(email))
  await expect(page).toHaveURL(new RegExp(`/${locale}/compte$`))
}

async function noOverflowAt390(page: Page) {
  const size = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, page.url()).toBeLessThanOrEqual(0)
  if (size) await page.setViewportSize(size)
}

const suffix = () => randomBytes(3).toString('hex')
const { long } = CATALOGUE_SEED

test('espace auteur : redirection vers la connexion sans session', async ({ page }) => {
  await page.goto('/fr/compte/decks')
  await expect(page).toHaveURL(/\/fr\/compte\/connexion$/)
  await page.goto('/en/compte/decks/verbs')
  await expect(page).toHaveURL(/\/en\/compte\/connexion$/)
})

test('espace auteur : pseudo, deck, jeton copié, publication, validation par l’admin', async ({
  page,
  browser,
  context,
}) => {
  const t = deckMessages.fr
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await signIn(page, 'fr', `author-${suffix()}@example.test`)

  // Handle: refused, then chosen. The account page leads to the author space.
  await page.getByRole('link', { name: t.space.title }).click()
  await expect(page).toHaveURL(/\/fr\/compte\/decks$/)
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { level: 1, name: t.space.title })).toBeVisible()
  // No handle yet: the header's menu is « Compte ».
  const banner = page.getByRole('banner')
  await expect(banner.getByRole('button', { name: /^Compte/ })).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  const handleField = page.getByRole('textbox', { name: t.space.handleLabel })
  await handleField.fill('A!')
  await page.getByRole('button', { name: t.space.handleSubmit }).click()
  await expect(page.getByText(t.space.handleErrors.invalid_handle)).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  const handle = `auteur-${suffix()}`
  await handleField.fill(handle)
  await page.getByRole('button', { name: t.space.handleSubmit }).click()
  await expect(page.getByRole('main').getByText(handle, { exact: true })).toBeVisible()
  // The header now names the menu after the handle, from the page's refresh.
  await expect(banner.getByRole('button', { name: new RegExp(`^${handle}`) })).toBeVisible()
  await banner.getByRole('button', { name: new RegExp(`^${handle}`) }).click()
  await expect(banner.getByRole('link', { name: t.space.title })).toHaveAttribute(
    'href',
    '/fr/compte/decks',
  )
  expect(await accessibilityViolations(page)).toEqual([])
  await page.keyboard.press('Escape')
  await expect(page.getByText(t.space.noDecks)).toBeVisible()

  // A deck and its token, shown once and copied.
  await page.getByRole('textbox', { name: t.space.deckIdLabel }).fill('verbs')
  await page.getByRole('button', { name: t.space.newSubmit }).click()
  const tokenField = page.getByRole('textbox', { name: t.token.label })
  await expect(tokenField).toHaveValue(/^ddk_[A-Za-z0-9_-]{43}$/)
  const token = await tokenField.inputValue()
  expect(page.url()).not.toContain(token)
  await page.getByRole('button', { name: t.token.copy }).click()
  await expect(page.getByText(t.token.copied)).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token)
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
  await page.getByRole('button', { name: t.token.hide }).click()
  await expect(page.getByRole('textbox', { name: t.token.label })).toHaveCount(0)
  expect(await page.content()).not.toContain(token)
  await expect(page.getByRole('link', { name: 'verbs' })).toBeVisible()
  // The list: its status pill, and the sidebar of the author space (tabs at 390 px).
  const sidebar = page.getByRole('navigation', { name: t.space.navLabel })
  await expect(sidebar.getByRole('link', { name: t.space.nav.decks })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(sidebar.getByRole('link', { name: t.space.nav.account })).toHaveAttribute(
    'href',
    '/fr/compte',
  )
  await expect(page.getByRole('listitem').filter({ hasText: t.space.noVersion })).toContainText(
    t.status.pending,
  )
  await page.emulateMedia({ colorScheme: 'dark' })
  // Reloaded: axe would otherwise measure colours still transitioning to the dark theme.
  await page.reload()
  expect(await accessibilityViolations(page)).toEqual([])
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()

  // Before any version: the 3-step guide, with the hub's address to copy.
  await page.getByRole('link', { name: 'verbs' }).click()
  await expect(page).toHaveURL(/\/fr\/compte\/decks\/verbs$/)
  const guide = page.getByRole('region', { name: t.deck.guideTitle })
  await expect(guide).toBeVisible()
  const hubOrigin = new URL(page.url()).origin
  await expect(guide.getByTestId('hub-url')).toHaveText(hubOrigin)
  await guide.getByRole('button', { name: t.token.copy }).click()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(hubOrigin)
  await expect(guide.getByRole('link', { name: t.deck.guideLink })).toHaveAttribute(
    'href',
    '/fr/guide/publier-avec-github',
  )
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
  await page.emulateMedia({ colorScheme: 'dark' })
  // Reloaded: axe would otherwise measure colours still transitioning to the dark theme.
  await page.reload()
  expect(await accessibilityViolations(page)).toEqual([])
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  await page.getByRole('navigation', { name: t.deck.breadcrumb }).getByRole('link').click()
  await expect(page).toHaveURL(/\/fr\/compte\/decks$/)

  // The CI publishes with the copied token: the deck awaits review.
  const published = await page.request.post('/api/publish/en', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' },
    data: await editionArchive(deckJson({ id: 'verbs', edition: 'en', version: '2026-11-26-e2e' })),
  })
  expect(published.status(), await published.text()).toBe(200)
  expect(((await published.json()) as { status: string }).status).toBe('pending_review')

  await page.getByRole('link', { name: 'verbs' }).click()
  await expect(page).toHaveURL(/\/fr\/compte\/decks\/verbs$/)
  await expect(page.getByTestId('deck-status')).toHaveText(t.status.pending)
  // A version is in: the guide gives way to the versions.
  await expect(page.getByRole('region', { name: t.deck.guideTitle })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: '2026-11-26-e2e' })).toBeVisible()
  await expect(page.getByText('<edition>')).toHaveCount(0)
  const origin = new URL(page.url()).origin
  await expect(page.getByText(`${origin}/d/${handle}/verbs/en/`, { exact: true })).toBeVisible()
  await expect(page.getByText('DECKDOCK_TOKEN', { exact: true })).toBeVisible()
  await expect(page.getByText('DECKDOCK_HUB_URL', { exact: true })).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
  // Confirmation steps are part of the page too.
  await page.getByRole('button', { name: t.token.revoke }).click()
  await expect(page.getByText(t.token.revokeQuestion)).toBeFocused()
  expect(await accessibilityViolations(page)).toEqual([])
  await page.getByRole('button', { name: t.token.cancel }).click()

  // An administrator validates it from the dashboard.
  const adminContext = await browser.newContext({ locale: 'fr-FR' })
  try {
    const admin = await adminContext.newPage()
    await signInAdmin(admin)
    await admin.goto('/admin')
    await admin.waitForLoadState('networkidle')
    const panel = admin.getByRole('region', { name: 'Decks en attente de validation' })
    await panel.getByRole('button', { name: `Valider ${handle}/verbs` }).click()
    await expect(panel.getByRole('status').filter({ hasText: 'publié' })).toBeVisible()
  } finally {
    await adminContext.close()
  }

  await page.reload()
  await expect(page.getByTestId('deck-status')).toHaveText(t.status.approved)
  // The « Publié » pill, in both themes.
  expect(await accessibilityViolations(page)).toEqual([])
  await page.emulateMedia({ colorScheme: 'dark' })
  // Reloaded: axe would otherwise measure colours still transitioning to the dark theme.
  await page.reload()
  expect(await accessibilityViolations(page)).toEqual([])
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  const served = await page.request.get(`/d/${handle}/verbs/en/deck.json`)
  expect(served.status()).toBe(200)

  // Regenerating gives a new token, shown once; the old one no longer publishes.
  await page.getByRole('button', { name: t.token.regenerate }).click()
  await page.getByRole('button', { name: t.token.regenerateConfirm }).click()
  await expect(page.getByRole('textbox', { name: t.token.label })).toHaveValue(/^ddk_/)
  expect(await page.getByRole('textbox', { name: t.token.label }).inputValue()).not.toBe(token)
  const stale = await page.request.post('/api/publish/en', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' },
    data: await editionArchive(deckJson({ id: 'verbs', edition: 'en', version: '2026-11-27-e2e' })),
  })
  expect(stale.status()).toBe(401)
})

test('un administrateur aussi connecté comme visiteur : son menu, puis son espace auteur', async ({
  page,
}) => {
  await signInAdmin(page)
  await signIn(page, 'fr', `admin-visitor-${suffix()}@example.test`)
  const banner = page.getByRole('banner')
  await expect(banner.getByRole('link', { name: 'Connexion' })).toHaveCount(0)
  await expect(banner.getByRole('button', { name: /^Compte/ })).toBeVisible()
  // The same on a page of the site layer, and the sign-in page still sends them to their account.
  await page.goto('/fr/mentions-legales')
  await expect(banner.getByRole('button', { name: /^Compte/ })).toBeVisible()
  await page.goto('/fr/compte/connexion')
  await expect(page).toHaveURL(/\/fr\/compte$/)
  // « Mes decks », from the header's menu and from the account page, opens the author space.
  const mine = deckMessages.fr.space.title
  await banner.getByRole('button', { name: /^Compte/ }).click()
  await banner.getByRole('link', { name: mine }).click()
  await expect(page).toHaveURL(/\/fr\/compte\/decks$/)
  await expect(page.getByRole('heading', { level: 1, name: mine })).toBeVisible()
  await page.goto('/fr/compte')
  await page.getByRole('main').getByRole('link', { name: mine }).click()
  await expect(page).toHaveURL(/\/fr\/compte\/decks$/)
  await expect(page.getByRole('heading', { level: 1, name: mine })).toBeVisible()
  // The administration still sees an administrator.
  await page.goto('/admin')
  await expect(page).not.toHaveURL(/\/admin\/login/)
})

test('author space in English', async ({ page }) => {
  const t = deckMessages.en
  await signIn(page, 'en', `author-en-${suffix()}@example.test`)
  await page.goto('/en/compte/decks')
  await expect(page.getByRole('heading', { level: 1, name: t.space.title })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: t.space.handleTitle })).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
  // Under 768 px the sidebar is a row of tabs above the page.
  await page.setViewportSize({ width: 390, height: 844 })
  const tabs = page.getByRole('navigation', { name: t.space.navLabel })
  await expect(tabs.getByRole('link', { name: t.space.nav.guide })).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  await page.emulateMedia({ colorScheme: 'dark' })
  // Reloaded: axe would otherwise measure colours still transitioning to the dark theme.
  await page.reload()
  expect(await accessibilityViolations(page)).toEqual([])
  // Another author's deck, or none: not found, nothing revealed.
  const missing = await page.goto('/en/compte/decks/nobody-s-deck')
  expect(missing?.status()).toBe(404)
})

/** The header as the server sent it, before any script runs: what the visitor sees first. */
async function serverHeader(page: Page, path: string) {
  const html = await (await page.request.get(path)).text()
  return html.slice(html.indexOf('<header'), html.indexOf('</header>'))
}

/** Opens `path` and lets it hydrate: no script error, no hydration mismatch. */
async function hydrated(page: Page, path: string) {
  const errors = pageErrors(page)
  await page.goto(path)
  await page.waitForLoadState('networkidle')
  expect(errors, path).toEqual([])
}

test('en-tête : non connecté, sans pseudo, avec pseudo, administrateur — rendu serveur, sans erreur d’hydratation', async ({
  page,
  browser,
}) => {
  const signInLink = 'href="/fr/compte/connexion"'
  // Signed out: « Connexion », in the HTML itself.
  expect(await serverHeader(page, '/fr')).toContain(signInLink)
  for (const path of ['/fr', '/fr/decks', '/fr/guide']) await hydrated(page, path)

  // Signed in without a handle: the menu « Compte », never « Connexion » first.
  await signIn(page, 'fr', `header-${suffix()}@example.test`)
  const noHandle = await serverHeader(page, '/fr/decks')
  expect(noHandle).not.toContain(signInLink)
  expect(noHandle).toMatch(/class="account-name">Compte</)
  for (const path of ['/fr', '/fr/decks', '/fr/compte', '/fr/compte/decks'])
    await hydrated(page, path)

  // With a handle (the longest allowed): the menu carries it.
  const handle = `pseudo-tres-long-auteur-${suffix()}`
  expect(handle).toHaveLength(30)
  await page.goto('/fr/compte/decks')
  await page.waitForLoadState('networkidle')
  await page.getByRole('textbox', { name: deckMessages.fr.space.handleLabel }).fill(handle)
  await page.getByRole('button', { name: deckMessages.fr.space.handleSubmit }).click()
  await expect(page.getByRole('main').getByText(handle, { exact: true })).toBeVisible()
  expect(await serverHeader(page, '/fr/guide')).toContain(`class="account-name">${handle}<`)
  for (const path of ['/fr', '/en/decks', '/fr/compte/decks']) await hydrated(page, path)

  // An administrator only (no visitor session): « Connexion », the administration is elsewhere.
  const adminContext = await browser.newContext({ locale: 'fr-FR' })
  try {
    const admin = await adminContext.newPage()
    await signInAdmin(admin)
    expect(await serverHeader(admin, '/fr')).toContain(signInLink)
    await hydrated(admin, '/fr')
    await expect(admin.getByRole('banner').getByRole('link', { name: 'Connexion' })).toBeVisible()
  } finally {
    await adminContext.close()
  }
})

test('espace auteur à 390 px : nom de 80 caractères, pseudo de 30, identifiant de 100, longue adresse d’édition', async ({
  page,
}) => {
  const t = deckMessages.fr
  await signIn(page, 'fr', `long-${suffix()}@example.test`)
  await page.goto('/fr/compte/decks')
  await page.waitForLoadState('networkidle')
  const handle = `pseudo-tres-long-auteur-${suffix()}`
  await page.getByRole('textbox', { name: t.space.handleLabel }).fill(handle)
  await page.getByRole('button', { name: t.space.handleSubmit }).click()
  await expect(page.getByRole('main').getByText(handle, { exact: true })).toBeVisible()
  const deckId = `${'tres-long-'.repeat(10).slice(0, 99)}9`
  expect(deckId).toHaveLength(100)
  await page.getByRole('textbox', { name: t.space.deckIdLabel }).fill(deckId)
  await page.getByRole('button', { name: t.space.newSubmit }).click()
  const token = await page.getByRole('textbox', { name: t.token.label }).inputValue()
  // An 80-character name, as the CI's deck.json gives it.
  const longDeck = deckJson({ id: deckId, edition: 'en', version: '2026-11-26-long' })
  longDeck.deck.name = long.name
  const published = await page.request.post('/api/publish/en', {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/gzip' },
    data: await editionArchive(longDeck),
  })
  expect(published.status(), await published.text()).toBe(200)

  const origin = new URL(page.url()).origin
  for (const path of ['/fr/compte/decks', `/fr/compte/decks/${deckId}`]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme })
      await page.setViewportSize({ width: 1280, height: 720 })
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      // The header's menu, named after the long handle, keeps to the bar on a computer.
      await expect(
        page.getByRole('banner').getByRole('button', { name: new RegExp(`^${handle}`) }),
      ).toBeVisible()
      expect(await pageOverflow(page), `${path} ${scheme} ordinateur`).toBeLessThanOrEqual(0)
      await page.setViewportSize({ width: 390, height: 844 })
      if (path.endsWith(deckId))
        await expect(
          page.getByText(`${origin}/d/${handle}/${deckId}/en/`, { exact: true }),
        ).toBeVisible()
      else
        await expect(
          page.getByRole('listitem').filter({ has: page.getByRole('link', { name: long.name }) }),
        ).toContainText(deckId)
      expect(await pageOverflow(page), `${path} ${scheme}`).toBeLessThanOrEqual(0)
      expect(await accessibilityViolations(page), `${path} ${scheme}`).toEqual([])
      // The mobile menu, with the handle at its head, open.
      await page.getByRole('banner').getByRole('button', { name: 'Menu' }).click()
      await expect(
        page.getByRole('banner').getByText(handle, { exact: true }).filter({ visible: true }),
      ).toHaveCount(1)
      expect(await pageOverflow(page), `${path} ${scheme} menu`).toBeLessThanOrEqual(0)
    }
  }
})
