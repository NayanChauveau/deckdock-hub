import { expect, test } from '@playwright/test'
import { accessibilityViolations, guardEveryPage } from './support'

guardEveryPage()

const contents = {
  fr: ['Comment ça marche', 'Publier avec GitHub', 'Publier sans GitHub', 'Le format en détail'],
  en: ['How it works', 'Publish with GitHub', 'Publish without GitHub', 'The format in detail'],
}

test('le guide : accueil, sommaire dans l’ordre, page courante et FR · EN', async ({ page }) => {
  await page.goto('/fr/guide')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Guide des auteurs')
  const sidebar = page.getByRole('navigation', { name: 'Sommaire du guide' })
  await expect(sidebar.getByRole('link')).toHaveText(['Accueil du guide', ...contents.fr])
  await expect(page.getByRole('banner').getByRole('link', { name: 'Guide' })).toHaveAttribute(
    'aria-current',
    'page',
  )

  await sidebar.getByRole('link', { name: 'Publier avec GitHub' }).click()
  await expect(page).toHaveURL(/\/fr\/guide\/publier-avec-github$/)
  await expect(sidebar.getByRole('link', { name: 'Publier avec GitHub' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(
    page.getByRole('banner').getByRole('link', { name: 'Publier un deck' }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('capture:')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^EN/ })).toHaveAttribute(
    'href',
    '/en/guide/publish-with-github',
  )

  await page.goto('/en/guide/format')
  await expect(
    page.getByRole('navigation', { name: 'Guide contents' }).getByRole('link'),
  ).toHaveText(['Guide home', ...contents.en])
  await expect(page.getByRole('link', { name: /^FR/ })).toHaveAttribute('href', '/fr/guide/format')
})

test('le guide : une page inconnue répond 404', async ({ page }) => {
  for (const path of [
    '/fr/guide/inexistant',
    '/en/guide/comment-ca-marche',
    '/fr/guide/format/x',
  ]) {
    const response = await page.goto(path)
    expect(response?.status(), path).toBe(404)
  }
})

test('le guide : le bouton Copier copie le bloc de code', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/fr/guide/publier-sans-github')
  const block = page.locator('.guide-code').filter({ hasText: 'deckdock publish dist' }).first()
  const code = await block.locator('code').innerText()
  await block.getByRole('button', { name: 'Copier' }).click()
  await expect(block.getByRole('button', { name: 'Copié' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code)
})

for (const path of [
  '/fr/guide',
  '/en/guide',
  '/fr/guide/comment-ca-marche',
  '/fr/guide/publier-avec-github',
  '/en/guide/publish-without-github',
  '/fr/guide/format',
]) {
  test(`le guide, accessibilité en clair et en sombre, 390 px sans débordement : ${path}`, async ({
    page,
  }) => {
    await page.goto(path)
    expect(await accessibilityViolations(page)).toEqual([])
    await page.emulateMedia({ colorScheme: 'dark' })
    // Reloaded: axe would otherwise measure colours still transitioning to the dark theme.
    await page.reload()
    expect(await accessibilityViolations(page)).toEqual([])
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}
