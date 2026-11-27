import { expect, test, type Page } from '@playwright/test'
import { catalogueMessages } from '../../src/modules/decks/catalogue-messages'
import { CATALOGUE_SEED } from '../support/catalogue-seed'
import { accessibilityViolations, guardEveryPage } from './support'

// The public catalogue, the deck page and the isolated card preview, on the decks published by
// tests/e2e/decks-catalogue.setup.ts (tests/run.mjs, browser stage).
guardEveryPage()

const { approved, pending, long } = CATALOGUE_SEED
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

test('accueil : les decks récents validés, en clair et en sombre, sans débordement', async ({
  page,
}) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto('/fr')
    await expect(
      page.getByRole('heading', { level: 1, name: 'Vos decks Anki, toujours à jour.' }),
    ).toBeVisible()
    // The author journey (decks-author.spec.ts) may have published decks of the same name.
    const recent = page.getByRole('region', { name: 'À découvrir' })
    const card = recent.locator(`a[href="${deckPath('fr')}"]`)
    await expect(card).toContainText('Verbes irréguliers')
    await expect(recent.getByText(pending.name)).toHaveCount(0)
    await expect(page.getByText('Publier le premier deck')).toHaveCount(0)
    expect(await accessibilityViolations(page), scheme).toEqual([])
    await noOverflowAt390(page)
  }
  await page.goto('/fr')
  await page
    .getByRole('region', { name: 'À découvrir' })
    .locator(`a[href="${deckPath('fr')}"]`)
    .click()
  await expect(page).toHaveURL(new RegExp(`${deckPath('fr')}$`))
  await page.goto('/en')
  await expect(
    page.getByRole('region', { name: 'Worth a look' }).locator(`a[href="${deckPath('en')}"]`),
  ).toContainText('Irregular verbs')
})

test('catalogue : recherche sans accents, pastilles de langue et tri', async ({ page }) => {
  const t = catalogueMessages.fr.catalogue
  await page.goto('/fr/decks')
  await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible()
  // The whole card is one link, named after the deck.
  const deck = page.getByRole('link', { name: 'Verbes irréguliers' })
  await expect(deck).toBeVisible()
  await expect(deck).toHaveAttribute('href', deckPath('fr'))
  await expect(deck).toHaveText('Verbes irréguliers')
  const item = page.getByRole('listitem').filter({ has: deck })
  await expect(item.getByRole('link')).toHaveCount(1)
  await expect(item).toContainText(`${t.by} ${approved.handle}`)
  await expect(item).toContainText(t.notes(2))
  // A pending deck is absent from the catalogue.
  await expect(page.getByText(pending.name)).toHaveCount(0)
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    expect(await accessibilityViolations(page), scheme).toEqual([])
    await noOverflowAt390(page)
  }

  // Search without case or accents.
  const searchbox = page.getByRole('searchbox', { name: t.searchLabel })
  await searchbox.fill('IRREGULIERS')
  await page.getByRole('button', { name: t.submit }).click()
  await expect(page).toHaveURL(/\/fr\/decks\?q=IRREGULIERS/)
  await expect(deck).toBeVisible()
  await searchbox.fill('confidentiel')
  await page.getByRole('button', { name: t.submit }).click()
  await expect(page.getByRole('heading', { level: 2, name: t.results(0) })).toBeVisible()
  await expect(page.getByText(t.noResultText)).toBeVisible()
  await expect(page.getByText(pending.name)).toHaveCount(0)
  expect(await accessibilityViolations(page)).toEqual([])
  await page.getByRole('link', { name: t.clear }).click()
  await expect(page).toHaveURL(/\/fr\/decks$/)

  // Language pills are links (no JavaScript needed): English matches (the deck's English edition,
  // "Irregular verbs", holds the words searched), and the pill keeps the search and the sort.
  const languages = page.getByRole('navigation', { name: t.languageFilter })
  await expect(languages.getByRole('link').first()).toHaveText(t.anyLanguage)
  await expect(languages.getByRole('link', { name: t.anyLanguage })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await page.goto('/fr/decks?q=verbs&sort=name')
  await languages.getByRole('link', { name: 'English' }).click()
  await expect(page).toHaveURL(/\/fr\/decks\?q=verbs&lang=en&sort=name$/)
  await expect(languages.getByRole('link', { name: 'English' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(deck).toBeVisible()
  await page.goto('/fr/decks?lang=de')
  await expect(page.getByRole('heading', { level: 2, name: t.results(0) })).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])

  // The sort, a native select of the same GET form.
  await page.goto('/fr/decks')
  await page.getByRole('combobox', { name: t.sortLabel }).selectOption('name')
  await page.getByRole('button', { name: t.submit }).click()
  await expect(page).toHaveURL(/sort=name/)
  await expect(page.getByRole('combobox', { name: t.sortLabel })).toHaveValue('name')

  // Past the last page: an empty page with a way back, not an error.
  const response = await page.goto('/fr/decks?page=99')
  expect(response?.status()).toBe(200)
  await page.getByRole('link', { name: t.firstPage }).click()
  await expect(page).toHaveURL(/\/fr\/decks$/)
  await expect(deck).toBeVisible()
})

test('catalogue à 390 px : nom, description et pseudo très longs ne débordent pas', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    await page.goto(`/fr/decks?q=${encodeURIComponent('membre supérieur')}`)
    const link = page.getByRole('link', { name: long.name })
    await expect(link).toBeVisible()
    const card = page.getByRole('listitem').filter({ has: link })
    await expect(card).toContainText(long.handle)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow, scheme).toBeLessThanOrEqual(0)
    // Nothing in the card sticks out of it either.
    const box = await card.boundingBox()
    const widest = await card.evaluate((element) =>
      Math.max(
        ...[...element.querySelectorAll('*')].map((child) => child.getBoundingClientRect().right),
      ),
    )
    expect(box).not.toBeNull()
    if (box) expect(widest, scheme).toBeLessThanOrEqual(box.x + box.width + 0.5)
    expect(await accessibilityViolations(page), scheme).toEqual([])
  }
})

test('page de deck en français : suivre dans Anki, aperçu en carrousel isolé, en bref', async ({
  page,
  context,
}) => {
  const t = catalogueMessages.fr.deck
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/fr/decks')
  await page.getByRole('link', { name: 'Verbes irréguliers' }).click()
  await expect(page).toHaveURL(new RegExp(`${deckPath('fr')}$`))
  const heading = page.getByRole('heading', { level: 1, name: 'Verbes irréguliers' })
  await expect(heading).toBeVisible()
  const header = page.locator('header', { has: heading })
  await expect(header).toContainText(`${t.by} ${approved.handle}`)
  await expect(header).toContainText('CC-BY-4.0')
  await expect(header).toContainText(/mis à jour (il y a|à l’instant)/)
  // The shared header and footer; FR · EN lead to this deck in the other language.
  const banner = page.getByRole('banner')
  await expect(page.getByRole('contentinfo')).toBeVisible()
  await expect(banner.getByRole('link', { name: /^EN/ })).toHaveAttribute('href', deckPath('en'))
  await expect(banner.getByRole('link', { name: /^FR/ })).toHaveAttribute('href', deckPath('fr'))

  // « Suivre ce deck dans Anki »: a tab per edition, the shown edition's address, Copy.
  const follow = page.getByRole('region', { name: t.followTitle })
  const tabs = follow.getByRole('navigation', { name: t.editionsTitle })
  await expect(tabs.getByRole('link', { name: 'Français' })).toHaveAttribute('aria-current', 'page')
  const origin = new URL(page.url()).origin
  const address = `${origin}/d/${approved.handle}/${approved.deckId}/fr/`
  await expect(page.getByTestId('address-fr')).toHaveText(address)
  await follow.getByRole('button', { name: t.copy }).click()
  await expect(follow.getByText(t.copied)).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address)
  await expect(follow.getByRole('link', { name: new RegExp(t.installAddon) })).toHaveAttribute(
    'href',
    'https://github.com/NayanChauveau/deckdock/tree/main/addon',
  )
  // « En bref »: notes, languages, licence and the https homepage as « Source ».
  const facts = page.getByRole('region', { name: t.facts })
  await expect(facts).toContainText('CC-BY-4.0')
  await expect(facts.getByRole('link', { name: /example\.test/ })).toHaveAttribute(
    'href',
    'https://example.test/verbes',
  )
  // Safe Markdown: bold rendered, the author's HTML shown as text.
  await expect(page.locator('strong', { hasText: 'irréguliers' })).toBeVisible()
  await expect(page.getByText('<b>pas du HTML</b>', { exact: false })).toBeVisible()

  // The carousel: one note at a time, front and back side by side, in sandboxed frames that
  // really draw the card and its image (Chromium).
  const preview = page.getByRole('region', { name: t.previewTitle })
  const frames = preview.locator('iframe')
  await expect(frames).toHaveCount(2)
  for (const frame of await frames.all())
    await expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
  await loadPreviews(page)
  const front = page.frameLocator('iframe[src$="/fr/0/front"]')
  await expect(front.locator('img')).toBeVisible()
  expect(
    await front.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth),
  ).toBeGreaterThan(0)
  await expect(front.locator('.q')).toContainText('go')
  const [frontBox, backBox] = [await frames.nth(0).boundingBox(), await frames.nth(1).boundingBox()]
  expect(frontBox && backBox && Math.abs(frontBox.y - backBox.y) < 1, 'side by side').toBe(true)
  await expect(preview.getByRole('status')).toHaveText('Note 1 sur 2')
  await preview.getByRole('button', { name: t.nextNote }).click()
  await expect(preview.getByRole('status')).toHaveText('Note 2 sur 2')
  await loadPreviews(page)
  await expect(page.frameLocator('iframe[src$="/fr/1/back"]').locator('.cloze')).toHaveText('parti')
  await expect(page.frameLocator('iframe[src$="/fr/1/front"]').locator('.cloze')).toHaveText(
    '[...]',
  )
  // Keyboard: the buttons are reachable and work with Enter.
  await preview.getByRole('button', { name: t.previousNote }).focus()
  await page.keyboard.press('Enter')
  await expect(preview.getByRole('status')).toHaveText('Note 1 sur 2')

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    expect(await accessibilityViolations(page), scheme).toEqual([])
    await noOverflowAt390(page)
  }
  // On a phone the follow block comes right under the deck's header, before the preview.
  await page.setViewportSize({ width: 390, height: 844 })
  const [headerBox, followBox, previewBox] = await Promise.all([
    header.boundingBox(),
    follow.boundingBox(),
    preview.boundingBox(),
  ])
  expect(headerBox && followBox && previewBox).toBeTruthy()
  if (headerBox && followBox && previewBox) {
    expect(followBox.y).toBeGreaterThan(headerBox.y)
    expect(previewBox.y).toBeGreaterThan(followBox.y)
  }
})

test('deck page in English: the English edition by default', async ({ page }) => {
  const t = catalogueMessages.en.deck
  await page.goto(deckPath('en'))
  await expect(page.getByRole('heading', { level: 1, name: 'Irregular verbs' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: t.followTitle })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: t.historyTitle })).toBeVisible()
  await expect(page.getByTestId('address-en')).toHaveText(/\/d\/olivia\/verbes\/en\/$/)
  await loadPreviews(page)
  expect(await accessibilityViolations(page)).toEqual([])
  await noOverflowAt390(page)
  // The French edition on request.
  await page
    .getByRole('navigation', { name: t.editionsTitle })
    .getByRole('link', { name: 'Français' })
    .click()
  await expect(page.getByRole('heading', { level: 1, name: 'Verbes irréguliers' })).toBeVisible()
  await expect(page.getByTestId('address-fr')).toBeVisible()
})

test('page de deck à 390 px : textes très longs, deck sans édition dans la langue du visiteur', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme })
    // The long deck has a French edition only: an English visitor sees it, with no gap.
    for (const locale of ['fr', 'en'] as const) {
      await page.goto(`/${locale}/d/${long.handle}/${long.deckId}`)
      await expect(page.getByRole('heading', { level: 1, name: long.name })).toBeVisible()
      await expect(page.getByTestId('address-fr')).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${locale} ${scheme}`).toBeLessThanOrEqual(0)
      expect(await accessibilityViolations(page), `${locale} ${scheme}`).toEqual([])
    }
  }
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
