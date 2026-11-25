import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { orderMessages } from '../../src/modules/orders/messages'
import { accessibilityViolations, guardEveryPage, signInAdmin } from './support'

/** The order waiting for payment placed by src/scripts/commerce-demo.ts (tests/run.mjs). */
function demoOrder(): { reference: string; link: string } {
  const file = process.env['DEMO_ORDER_FILE']
  if (!file) throw new Error('DEMO_ORDER_FILE absent : lancer la suite avec pnpm test')
  return JSON.parse(readFileSync(file, 'utf8')) as { reference: string; link: string }
}

guardEveryPage()

test('CSP : la page d’accès à une commande envoie une politique avec nonce', async ({
  request,
}) => {
  const response = await request.get('/en/commande/acces')
  expect(response.headers()['content-security-policy'] ?? '').toMatch(
    /script-src 'self' 'nonce-[A-Za-z0-9+/=]{22,}'/,
  )
})

test('accessibilité WCAG 2.1 AA : /en/commande/acces', async ({ page }) => {
  await page.goto('/en/commande/acces')
  expect(await accessibilityViolations(page)).toEqual([])
})

test('mobile 390 px sans débordement horizontal : /fr/commande/acces', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/fr/commande/acces')
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('parcours de commande : lien privé, paiement simulé, suivi et administration', async ({
  page,
}) => {
  const t = orderMessages.fr
  const order = demoOrder()
  // The private link of the order emails: the access page exchanges it for the tracking cookie.
  await page.goto(new URL(order.link).pathname + new URL(order.link).hash)
  await expect(page).toHaveURL(/\/fr\/commande\/suivi\//)
  await expect(page.getByText(t.pending)).toBeVisible()
  expect(await accessibilityViolations(page)).toEqual([])
  // The button is server-rendered: on a cold dev server a click before hydration would be lost.
  await page.waitForLoadState('networkidle')
  const confirmation = page.waitForResponse(
    (response) => response.url().endsWith('/api/commerce/simulate') && response.ok(),
  )
  await page.getByRole('button', { name: t.simulate }).click()
  await confirmation
  await expect(page.getByText(t.paid)).toBeVisible()
  await expect(page.getByText(t.queued)).toBeVisible()

  const reference = order.reference
  expect(new URL(page.url()).pathname.split('/').at(-1)).toBe(reference)
  await signInAdmin(page)
  await page.goto('/admin/collections/orders')
  await page.getByRole('link', { name: reference, exact: true }).click()
  const paidBadge = page.getByText('Payé', { exact: true })
  const fulfillmentControl = page.locator('.rs__control').filter({ hasText: 'En file' })
  await expect(paidBadge).toHaveCSS('background-color', 'rgb(220, 252, 231)')
  await expect(fulfillmentControl).toBeVisible()
  const badgeBox = await paidBadge.boundingBox()
  const controlBox = await fulfillmentControl.boundingBox()
  if (!badgeBox || !controlBox) throw new Error('Les statuts de la commande doivent être visibles')
  expect(
    Math.abs(badgeBox.y + badgeBox.height / 2 - (controlBox.y + controlBox.height / 2)),
  ).toBeLessThanOrEqual(2)
  await expect(page.getByText('Commentaire du client', { exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Note interne' })).toBeEditable()
  await expect(page.getByText('Session Stripe', { exact: true })).toBeHidden()

  const saveOrder = async () => {
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PATCH' && response.url().includes('/api/orders/'),
    )
    await page.getByRole('button', { name: 'Sauvegarder', exact: true }).click()
    const response = await saved
    expect(response.ok(), await response.text()).toBe(true)
  }

  await fulfillmentControl.click()
  await page.getByText('En cours', { exact: true }).click()
  await saveOrder()
  await page.reload()
  const inProgress = page.locator('.rs__control').filter({ hasText: 'En cours' })
  await expect(inProgress).toBeVisible()

  const trackingNumber = page.getByRole('textbox', { name: 'Numéro de suivi (facultatif)' })
  // Always visible, so it can be filled in before the order is shipped.
  await expect(trackingNumber).toBeVisible()
  await inProgress.click()
  await page.getByText('Prêt', { exact: true }).click()
  await saveOrder()

  await page.locator('.rs__control').filter({ hasText: 'Prêt' }).click()
  await page.getByText('Expédié', { exact: true }).click()
  await trackingNumber.fill('TEST-EXPEDITION')
  await saveOrder()
  await page.reload()
  await expect(trackingNumber).toHaveValue('TEST-EXPEDITION')
})
