import { expect, test, type Page } from '@playwright/test'
import { catalogueMessages } from '../../src/modules/decks/catalogue-messages'
import { CATALOGUE_SEED } from '../support/catalogue-seed'
import { accessibilityViolations, guardEveryPage } from './support'

// The public catalogue, the deck page and the isolated card preview, on the decks published by
// tests/e2e/decks-catalogue.setup.ts (tests/run.mjs, browser stage).
guardEveryPage()

const { approved, pending } = CATALOGUE_SEED
const deckPath = (locale: 'fr' | 'en') => `/${locale}/d/${approved.handle}/${approved.deckId}`

async function noOverflowAt390(page: Page) {
  const size = page.viewportSize()
  await page.setViewportSize({ width: 390, height: 844 })
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow, page.url()).toBeLessThanOrEqual(0)
  if (size) await page.setViewportSize(size)
}

/** Every preview frame loaded (they are lazy): scrolled into view, its document answered. */
async function loadPreviews(page: Page) {
  const frames = page.locator('iframe')
  const count = await frames.count()
  for (let i = 0; i < count; i++) await frames.nth(i).scrollIntoViewIfNeeded()
  await expect
    .poll(() => page.frames().filter((frame) => frame.url().includes('/preview/')).length)
    .toBe(count)
  await page.waitForLoadState('networkidle')
}

test('catalogue : recherche sans accents et filtre de langue', async ({ page }) => {
  const t = catalogueMessages.fr.catalogue
  await page.goto('/fr/decks')
  await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible()
  const deck = page.getByRole('link', { name: 'Verbes irréguliers' })
  await expect(deck).toBeVisible()
  // A pending deck is absent from the catalogue.
  await expect(page.getByText(pending.name)).toHaveCount(0)
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)

  // Search without case or accents.
  await page.getByRole('searchbox', { name: t.searchLabel }).fill('IRREGULIERS')
  await page.getByRole('button', { name: t.submit }).click()
  await expect(page).toHaveURL(/\/fr\/decks\?q=IRREGULIERS/)
  await expect(deck).toBeVisible()
  await page.getByRole('searchbox', { name: t.searchLabel }).fill('confidentiel')
  await page.getByRole('button', { name: t.submit }).click()
  await expect(page.getByRole('heading', { level: 2, name: t.results(0) })).toBeVisible()
  await expect(page.getByText(pending.name)).toHaveCount(0)

  // Language filter: English matches (the deck has an English edition), German does not.
  await page.getByRole('searchbox', { name: t.searchLabel }).fill('')
  await page.getByLabel(t.languageLabel, { exact: true }).selectOption('en')
  await page.getByRole('button', { name: t.submit }).click()
  await expect(page).toHaveURL(/lang=en/)
  await expect(deck).toBeVisible()
  await page.goto('/fr/decks?lang=de')
  await expect(page.getByRole('heading', { level: 2, name: t.results(0) })).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
})

test('page de deck en français : éditions, adresse à copier, aperçu isolé', async ({
  page,
  context,
}) => {
  const t = catalogueMessages.fr.deck
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/fr/decks')
  await page.getByRole('link', { name: 'Verbes irréguliers' }).click()
  await expect(page).toHaveURL(new RegExp(`${deckPath('fr')}$`))
  await expect(page.getByRole('heading', { level: 1, name: 'Verbes irréguliers' })).toBeVisible()
  await expect(page.getByText('CC-BY-4.0')).toBeVisible()
  // The shared header and footer; FR · EN lead to this deck in the other language.
  const banner = page.getByRole('banner')
  await expect(page.getByRole('contentinfo')).toBeVisible()
  await expect(banner.getByRole('link', { name: /^EN/ })).toHaveAttribute('href', deckPath('en'))
  await expect(banner.getByRole('link', { name: /^FR/ })).toHaveAttribute('href', deckPath('fr'))
  const origin = new URL(page.url()).origin
  const address = `${origin}/d/${approved.handle}/${approved.deckId}/fr/`
  await expect(page.getByTestId('address-fr')).toHaveText(address)
  await page.getByRole('button', { name: t.copy('fr') }).click()
  await expect(page.getByText(t.copied)).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address)
  // Safe Markdown: bold rendered, the author's HTML shown as text.
  await expect(page.locator('strong', { hasText: 'irréguliers' })).toBeVisible()
  await expect(page.getByText('<b>pas du HTML</b>', { exact: false })).toBeVisible()

  const frames = page.locator('iframe')
  await expect(frames).toHaveCount(4)
  for (const frame of await frames.all())
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  await loadPreviews(page)
  const front = page.frameLocator('iframe[src$="/fr/0/front"]')
  await expect(front.locator('img')).toBeVisible()
  await expect(page.frameLocator('iframe[src$="/fr/1/back"]').locator('.cloze')).toHaveText('parti')
  await expect(page.frameLocator('iframe[src$="/fr/1/front"]').locator('.cloze')).toHaveText(
    '[...]',
  )
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
})

test('deck page in English: the English edition by default', async ({ page }) => {
  const t = catalogueMessages.en.deck
  await page.goto(deckPath('en'))
  await expect(page.getByRole('heading', { level: 1, name: 'Irregular verbs' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: t.editionsTitle })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: t.historyTitle })).toBeVisible()
  await loadPreviews(page)
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
  // The French edition on request.
  await page.getByRole('link', { name: t.show('fr') }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Verbes irréguliers' })).toBeVisible()
})

test('un deck en attente n’existe pas pour les visiteurs', async ({ page }) => {
  const response = await page.goto(`/fr/d/${pending.handle}/${pending.deckId}`)
  expect(response?.status()).toBe(404)
  await expect(page.getByText(pending.name)).toHaveCount(0)
  await expect(page.getByRole('banner')).toBeVisible()
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.getByRole('contentinfo')).toBeVisible()
  await page.goto(`/fr/decks?q=${encodeURIComponent(pending.name)}`)
  await expect(page.getByText(pending.name)).toHaveCount(0)
})

test('le script d’une carte ne lit ni les cookies ni la page du site', async ({
  page,
  context,
}) => {
  const origin = new URL(test.info().project.use.baseURL ?? '').origin
  await context.addCookies([{ name: 'hub_probe', value: 'secret-value', url: origin }])
  await page.goto(deckPath('fr'))
  const title = await page.title()
  await loadPreviews(page)
  const frame = page.frames().find((candidate) => candidate.url().endsWith('/fr/0/front'))
  expect(frame).toBeTruthy()
  if (!frame) return
  await expect(frame.locator('img')).toBeVisible()

  // From the card's document: an opaque origin, where the cookie and the site's page throw.
  const inside = await frame.evaluate(() => {
    const attempt = (read: () => unknown) => {
      try {
        return { read: String(read()) }
      } catch (error) {
        return { threw: error instanceof DOMException ? error.name : String(error) }
      }
    }
    return {
      origin: self.origin,
      cookie: attempt(() => document.cookie),
      parentDocument: attempt(() => window.parent.document.title),
      storage: attempt(() => window.localStorage.length),
      // What the template's script managed to record, if it ran at all.
      recorded: document.body.dataset['cookie'] ?? null,
    }
  })
  expect(inside.origin).toBe('null')
  expect(inside.cookie).toEqual({ threw: 'SecurityError' })
  expect(inside.parentDocument).toEqual({ threw: 'SecurityError' })
  expect(inside.storage).toEqual({ threw: 'SecurityError' })
  expect(inside.recorded === null || inside.recorded === 'blocked').toBe(true)

  // From the site's page: nothing changed, and the cookie is still there, unread.
  expect(await page.title()).toBe(title)
  expect(await page.evaluate(() => document.cookie)).toContain('hub_probe=secret-value')
  expect(await page.content()).not.toContain('CARD_SCRIPT_MARKER')
})
