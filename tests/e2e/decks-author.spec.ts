import { expect, test, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { accountMessages } from '../../src/modules/accounts/messages'
import { deckMessages } from '../../src/modules/decks/messages'
import { deckJson, editionArchive } from '../support/deck-archive'
import { accessibilityViolations, guardEveryPage, signInAdmin } from './support'

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
  expect(await accessibilityViolations(page)).toEqual([])
  const handleField = page.getByRole('textbox', { name: t.space.handleLabel })
  await handleField.fill('A!')
  await page.getByRole('button', { name: t.space.handleSubmit }).click()
  await expect(page.getByText(t.space.handleErrors.invalid_handle)).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  const handle = `auteur-${suffix()}`
  await handleField.fill(handle)
  await page.getByRole('button', { name: t.space.handleSubmit }).click()
  await expect(page.getByText(handle, { exact: true })).toBeVisible()
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

test('author space in English', async ({ page }) => {
  const t = deckMessages.en
  await signIn(page, 'en', `author-en-${suffix()}@example.test`)
  await page.goto('/en/compte/decks')
  await expect(page.getByRole('heading', { level: 1, name: t.space.title })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: t.space.handleTitle })).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
  // Another author's deck, or none: not found, nothing revealed.
  const missing = await page.goto('/en/compte/decks/nobody-s-deck')
  expect(missing?.status()).toBe(404)
})
