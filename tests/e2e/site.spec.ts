import { expect, test, type Page } from '@playwright/test'
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

const isDark = (page: Page) =>
  page.evaluate(() => document.documentElement.classList.contains('dark'))

test('mode sombre : script de thème dans <head>, avec le nonce, avant le contenu', async ({
  request,
}) => {
  const response = await request.get('/fr')
  const nonce =
    /'nonce-([^']+)'/.exec(response.headers()['content-security-policy'] ?? '')?.[1] ?? ''
  const html = await response.text()
  const script = html.search(
    new RegExp(
      `<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}">\\(function\\(\\)\\{[^<]*"site-theme"`,
    ),
  )
  expect(script, 'script de thème porteur du nonce').toBeGreaterThan(-1)
  expect(script, 'avant <body>').toBeLessThan(html.indexOf('<body'))
})

test('mode sombre : système sombre, la page est sombre dès le chargement', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/fr', { waitUntil: 'commit' })
  await page.waitForSelector('body', { state: 'attached' })
  expect(await isDark(page)).toBe(true)
})

test('404 : rendue sur le serveur dans le layout public, sombre dès le chargement', async ({
  page,
  request,
}) => {
  const response = await request.get('/fr/page-inexistante')
  expect(response.status()).toBe(404)
  const html = await response.text()
  // Not Next's error shell, which skips the layout's <head> and draws the 404 only in the browser.
  expect(html).not.toContain('__next_error__')
  expect(html).toContain('<html lang="fr"')
  const script = html.indexOf('"site-theme"')
  expect(script, 'script de thème').toBeGreaterThan(-1)
  expect(script, 'avant <body>').toBeLessThan(html.indexOf('<body'))
  expect(html).toContain('Cette page est introuvable')

  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/fr/page-inexistante', { waitUntil: 'commit' })
  await page.waitForSelector('body', { state: 'attached' })
  expect(await isDark(page)).toBe(true)
  await page.waitForLoadState('networkidle')
  // Hydrated without a mismatch (the 404 response itself is not a page error).
  expect(errors.filter((text) => !text.includes('status of 404'))).toEqual([])
})

test('mode sombre : choix mémorisé après rechargement et navigation', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/fr')
  const toggle = page.getByRole('button', { name: /^Thème :/ })
  await toggle.click() // système → clair
  await expect(page.getByRole('button', { name: 'Thème : clair' })).toBeVisible()
  await toggle.click() // clair → sombre
  await expect(page.getByRole('button', { name: 'Thème : sombre' })).toBeVisible()
  expect(await isDark(page)).toBe(true)
  await page.reload()
  expect(await isDark(page)).toBe(true)
  await page.getByRole('link', { name: 'Mentions légales' }).click()
  await expect(page).toHaveURL(/mentions-legales/)
  expect(await isDark(page)).toBe(true)
})

for (const path of [
  '/fr',
  '/en',
  '/fr/conditions-generales-de-vente',
  '/en/privacy',
  '/fr/page-inexistante',
]) {
  test(`accessibilité WCAG 2.1 AA en sombre : ${path}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto(path)
    expect(await isDark(page)).toBe(true)
    expect(await accessibilityViolations(page)).toEqual([])
  })
}

test('mode sombre : à 390 px, le bouton de thème ne touche pas le sélecteur de langue', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/fr')
  const language = await page.getByRole('link', { name: /^EN/ }).boundingBox()
  const toggle = await page.getByRole('button', { name: /^Thème :/ }).boundingBox()
  expect(language && toggle).toBeTruthy()
  if (language && toggle) expect(toggle.x - (language.x + language.width)).toBeGreaterThanOrEqual(8)
})

test('mode sombre : l’administration n’a pas le thème du site', async ({ request }) => {
  const html = await (await request.get('/admin/login')).text()
  expect(html).not.toContain('site-theme')
})

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
