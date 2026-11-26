import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { accountMessages } from '../../src/modules/accounts/messages'
import { accessibilityViolations, guardEveryPage, signInAdmin } from './support'

guardEveryPage()

/** The last link emailed to `to` (the development server's mailbox, set by tests/run.mjs). */
function lastLink(to: string, kind: 'signInEmail' | 'deletionEmail'): string {
  const file = process.env['ACCOUNTS_TEST_MAILBOX']
  if (!file) throw new Error('ACCOUNTS_TEST_MAILBOX absent : lancer la suite avec pnpm test')
  const mails = readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { kind: string; to: string; url: string })
    .filter((mail) => mail.to === to && mail.kind === kind)
  const url = mails.at(-1)?.url
  if (!url) throw new Error(`Aucun e-mail ${kind} pour ${to}`)
  return url
}

let visitors = 0
const newVisitor = (locale: string) =>
  `browser-${locale}-${String(Date.now())}-${String(++visitors)}@example.test`

async function noOverflowAt390(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, page.url()).toBeLessThanOrEqual(0)
}

/** Asks for a link on the sign-in page, then opens it: the visitor lands on their account. */
async function signIn(page: Page, locale: 'fr' | 'en', email: string) {
  const t = accountMessages[locale].signIn
  await page.goto(`/${locale}/compte`)
  await expect(page).toHaveURL(new RegExp(`/${locale}/compte/connexion$`))
  // Server-rendered form: on a cold dev server a submit before hydration would be lost.
  await page.waitForLoadState('networkidle')
  await page.getByLabel(t.email).fill(email)
  await page.getByRole('button', { name: t.submit }).click()
  await expect(page.getByRole('main').getByRole('status')).toHaveText(t.sent)
  const link = lastLink(email, 'signInEmail')
  await page.goto(link)
  await expect(page).toHaveURL(new RegExp(`/${locale}/compte$`))
  await expect(page.getByText(email)).toBeVisible()
  await page.waitForLoadState('networkidle')
  return link
}

for (const locale of ['fr', 'en'] as const) {
  for (const path of ['compte/connexion', 'compte/supprime']) {
    test(`accessibilité WCAG 2.1 AA et 390 px : /${locale}/${path}`, async ({ page }) => {
      await page.goto(`/${locale}/${path}`)
      expect(await accessibilityViolations(page)).toEqual([])
      await noOverflowAt390(page)
    })
  }
}

test('accessibilité WCAG 2.1 AA en sombre : /fr/compte/connexion', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/fr/compte/connexion')
  expect(await accessibilityViolations(page)).toEqual([])
  // The « lien expiré » state of the card.
  await page.goto('/fr/compte/connexion?error=EXPIRED_TOKEN')
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    accountMessages.fr.signIn.linkError,
  )
  expect(await accessibilityViolations(page)).toEqual([])
})

test('connexion : la carte « lien envoyé », en clair et en sombre, à 390 px', async ({ page }) => {
  const t = accountMessages.en.signIn
  await page.goto('/en/compte/connexion')
  await page.waitForLoadState('networkidle')
  await expect(page.getByText(t.firstTime)).toBeVisible()
  await page.getByLabel(t.email).fill(newVisitor('en'))
  await page.getByRole('button', { name: t.submit }).click()
  await expect(page.getByRole('main').getByRole('status')).toHaveText(t.sent)
  await expect(page.getByRole('heading', { level: 2, name: t.sentTitle })).toBeFocused()
  expect(await accessibilityViolations(page)).toEqual([])
  await page.emulateMedia({ colorScheme: 'dark' })
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
  await page.getByRole('button', { name: t.otherAddress }).click()
  await expect(page.getByLabel(t.email)).toBeVisible()
})

test('en-tête : un administrateur aussi connecté comme visiteur voit son menu de visiteur', async ({
  page,
}) => {
  await signInAdmin(page)
  await signIn(page, 'fr', newVisitor('fr'))
  const banner = page.getByRole('banner')
  await expect(banner.getByRole('link', { name: 'Connexion' })).toHaveCount(0)
  await expect(banner.getByRole('button', { name: /^Compte/ })).toBeVisible()
  // The same on a page of the site layer, and the sign-in page still sends them to their account.
  await page.goto('/fr/mentions-legales')
  await expect(banner.getByRole('button', { name: /^Compte/ })).toBeVisible()
  await page.goto('/fr/compte/connexion')
  await expect(page).toHaveURL(/\/fr\/compte$/)
  // The administration still sees an administrator.
  await page.goto('/admin')
  await expect(page).not.toHaveURL(/\/admin\/login/)
})

test('compte : connexion par lien, Mon compte, déconnexion ; un lien déjà servi est expliqué', async ({
  page,
}) => {
  const t = accountMessages.fr
  const email = newVisitor('fr')
  const link = await signIn(page, 'fr', email)
  await expect(page.getByRole('heading', { level: 1, name: t.account.title })).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  await page.emulateMedia({ colorScheme: 'dark' })
  // Reloaded: axe would otherwise measure colours still transitioning to the dark theme.
  await page.reload()
  expect(await accessibilityViolations(page)).toEqual([])
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  // Confirmation step open as well: it is part of the page a visitor may see.
  await page.getByRole('button', { name: t.account.deleteStart }).click()
  await expect(page.getByText(t.account.deleteConfirmQuestion)).toBeFocused()
  expect(await accessibilityViolations(page)).toEqual([])
  await page.getByRole('button', { name: t.account.deleteCancel }).click()
  await noOverflowAt390(page)

  await page.getByRole('button', { name: t.account.signOut, exact: true }).click()
  await expect(page).toHaveURL(/\/fr\/compte\/connexion$/)
  await page.goto('/fr/compte')
  await expect(page).toHaveURL(/\/fr\/compte\/connexion$/)
  // The same sign-in link again: used up, the sign-in page says so and opens no session.
  await page.goto(link)
  await expect(page).toHaveURL(/\/fr\/compte\/connexion\?error=/)
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.signIn.linkError)
  expect(await accessibilityViolations(page)).toEqual([])
})

test('en-tête : menu « Compte » une fois connecté, déconnexion depuis le menu', async ({
  page,
}) => {
  const email = newVisitor('fr')
  await signIn(page, 'fr', email)
  const banner = page.getByRole('banner')
  await expect(banner.getByRole('link', { name: 'Connexion' })).toHaveCount(0)
  const menu = banner.getByRole('button', { name: /^Compte/ })
  await expect(menu).toHaveAttribute('aria-expanded', 'false')
  await menu.click()
  await expect(banner.getByRole('link', { name: 'Compte' })).toHaveAttribute('href', '/fr/compte')
  expect(await accessibilityViolations(page)).toEqual([])
  // Also on a page of the site layer, and the same in the dark theme.
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/fr/mentions-legales')
  await expect(banner.getByRole('button', { name: /^Compte/ })).toBeVisible()
  await banner.getByRole('button', { name: /^Compte/ }).click()
  expect(await accessibilityViolations(page)).toEqual([])
  await banner.getByRole('button', { name: 'Déconnexion' }).click()
  await expect(page).toHaveURL(/\/fr$/)
  await expect(banner.getByRole('link', { name: 'Connexion' })).toBeVisible()
  await page.goto('/fr/compte')
  await expect(page).toHaveURL(/\/fr\/compte\/connexion$/)
})

test('en-tête : à 390 px, le compte est dans le menu mobile', async ({ page }) => {
  await signIn(page, 'en', newVisitor('en'))
  await page.setViewportSize({ width: 390, height: 844 })
  const banner = page.getByRole('banner')
  await expect(banner.getByRole('button', { name: /^Account/ })).toBeHidden()
  await banner.getByRole('button', { name: 'Menu' }).click()
  await expect(banner.getByRole('link', { name: 'My decks' })).toBeVisible()
  await expect(banner.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
})

test('account: My account in English, then signing out of every device', async ({
  page,
  browser,
}) => {
  const t = accountMessages.en.account
  const email = newVisitor('en')
  await signIn(page, 'en', email)
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
  // A second browser signed in with the same address loses its session as well.
  const other = await browser.newContext({ locale: 'en-GB' })
  try {
    const second = await other.newPage()
    await signIn(second, 'en', email)
    await page.getByRole('button', { name: t.signOutEverywhere }).click()
    await expect(page).toHaveURL(/\/en\/compte\/connexion$/)
    await second.goto('/en/compte')
    await expect(second).toHaveURL(/\/en\/compte\/connexion$/)
  } finally {
    await other.close()
  }
})

test('compte : suppression confirmée sur la page puis par e-mail ; lien ouvert ailleurs expliqué', async ({
  page,
  browser,
}) => {
  const t = accountMessages.fr
  const email = newVisitor('fr')
  await signIn(page, 'fr', email)
  await page.getByRole('button', { name: t.account.deleteStart }).click()
  await page.getByRole('button', { name: t.account.deleteConfirm }).click()
  await expect(page.getByRole('main').getByRole('status')).toHaveText(t.account.deletionSent(email))
  expect(await accessibilityViolations(page)).toEqual([])
  const link = lastLink(email, 'deletionEmail')

  // Opened in another browser, without the session: a clear page, and nothing is deleted.
  const other = await browser.newContext({ locale: 'fr-FR' })
  try {
    const elsewhere = await other.newPage()
    await elsewhere.goto(link)
    await expect(elsewhere).toHaveURL(/\/fr\/compte\/connexion\?error=deletion_link$/)
    await expect(elsewhere.getByRole('main').getByRole('alert')).toHaveText(
      t.account.deletionLinkError,
    )
    expect(await accessibilityViolations(elsewhere)).toEqual([])
  } finally {
    await other.close()
  }
  await page.reload()
  await expect(page.getByText(email)).toBeVisible()

  await page.goto(link)
  await expect(page).toHaveURL(/\/fr\/compte\/supprime$/)
  await expect(page.getByRole('heading', { level: 1, name: t.deleted.title })).toBeVisible()
  await page.goto('/fr/compte')
  await expect(page).toHaveURL(/\/fr\/compte\/connexion$/)
  // The used link, back in the signed-out browser: explained, not raw JSON.
  await page.goto(link)
  await expect(page).toHaveURL(/\/fr\/compte\/connexion\?error=deletion_link$/)
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(t.account.deletionLinkError)
})
