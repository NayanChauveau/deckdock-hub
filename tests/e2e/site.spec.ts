import { expect, test } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { accessibilityViolations, enrolTotp, guardEveryPage, signInAdmin } from './support'

guardEveryPage()

test('CSP : le site et l’administration envoient une politique avec nonce', async ({ request }) => {
  for (const path of ['/fr', '/en', '/admin/login']) {
    const response = await request.get(path)
    const policy = response.headers()['content-security-policy'] ?? ''
    expect(policy, path).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{22,}'/)
    expect(policy, path).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    const html = await response.text()
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1] ?? ''
    expect(html, `${path} : scripts de Next.js porteurs du nonce`).toContain(`nonce="${nonce}"`)
  }
})

for (const path of [
  '/fr',
  '/en',
  '/fr/conditions-generales-de-vente',
  '/en/privacy',
  '/fr/page-inexistante',
]) {
  test(`accessibilité WCAG 2.1 AA : ${path}`, async ({ page }) => {
    await page.goto(path)
    expect(await accessibilityViolations(page)).toEqual([])
  })
}

for (const path of ['/fr', '/fr/mentions-legales']) {
  test(`mobile 390 px sans débordement horizontal : ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('invitation : connexion avec code TOTP, lien d’invitation, mot de passe puis enrôlement', async ({
  page,
  browser,
}) => {
  await signInAdmin(page)

  await page.goto('/admin/collections/users')
  await page.waitForLoadState('networkidle')
  const invitation = page.getByRole('region', { name: 'Inviter un administrateur' })
  await invitation.getByLabel('Email').fill('browser-invitee@example.test')
  await invitation.getByLabel('Nom').fill('Invitée navigateur')
  await invitation.getByRole('button', { name: 'Envoyer l’invitation' }).click()
  // Simulated email: the link is shown once, to be passed on by the administrator.
  const link = await invitation.getByLabel('Lien d’invitation').inputValue()
  expect(link).toMatch(/\/admin\/reset\/[a-f0-9]{40}$/)
  await expect(invitation.getByText('Ce lien ne sera plus affiché')).toBeVisible()
  await expect(page.getByRole('link', { name: 'browser-invitee@example.test' })).toBeVisible()

  const context = await browser.newContext({ locale: 'fr-FR' })
  try {
    const invitee = await context.newPage()
    await invitee.goto(new URL(link).pathname)
    await invitee.waitForLoadState('networkidle')
    const password = randomBytes(18).toString('hex')
    await invitee.getByLabel('Nouveau mot de passe').fill(password)
    await invitee.getByLabel('Confirmez le mot de passe').fill(password)
    await invitee.getByRole('button', { name: 'Réinitialiser le mot de passe' }).click()
    await enrolTotp(invitee)
    // Back on the (spent) link page, which Payload shows as signed in; the dashboard opens.
    await invitee.goto('/admin')
    await expect(invitee).toHaveURL(/\/admin\/?$/)
    // The browser session now carries the second factor: private data is readable.
    const status = await invitee.evaluate(async () => {
      const response = await fetch('/api/users?limit=1', { credentials: 'include' })
      return response.status
    })
    expect(status).toBe(200)
  } finally {
    await context.close()
  }
})
