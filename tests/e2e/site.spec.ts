import { expect, test, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { messages } from '../../src/core/i18n/messages'
import {
  accessibilityViolations,
  enrolTotp,
  guardEveryPage,
  pageErrors,
  pageOverflow,
  signInAdmin,
} from './support'

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

test('mode sombre : changer de langue ne rend pas de <script> côté client', async ({ page }) => {
  // The language switch re-renders the [locale] root layout in the browser; React logs an error
  // when that render contains an executable <script> (it never runs on the client).
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto('/fr')
  await page.getByRole('link', { name: /^EN/ }).click()
  await expect(page).toHaveURL(/\/en(\/|$)/)
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  expect(errors.filter((error) => /script tag/i.test(error))).toEqual([])
})

test('mode sombre : chargement puis changement de langue, sombre à chaque image', async ({
  page,
}) => {
  // Hydration must not apply the server's « system » snapshot over the stored choice, and the
  // language switch mounts a new [locale] root layout whose <html> React resets to its JSX
  // attributes: the theme must be back before the browser paints the next frame.
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/fr')
  await page.evaluate(() => {
    window.localStorage.setItem('site-theme', 'dark')
  })
  // One letter per image of the next document, from its first one and through the client
  // navigation (same document): D dark, - light, | the click.
  await page.addInitScript(() => {
    const record = () => {
      const w = window as unknown as { themeFrames?: string }
      w.themeFrames =
        (w.themeFrames ?? '') + (document.documentElement.classList.contains('dark') ? 'D' : '-')
      requestAnimationFrame(record)
    }
    requestAnimationFrame(record)
  })
  await page.reload()
  await expect(page.getByRole('button', { name: 'Thème : sombre' })).toBeVisible()
  const frames = () =>
    page.evaluate(() => (window as unknown as { themeFrames: string }).themeFrames)
  await page.evaluate(() => {
    ;(window as unknown as { themeFrames: string }).themeFrames += '|'
  })
  await page.getByRole('link', { name: /^EN/ }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.waitForTimeout(500)
  expect(await frames()).toMatch(/D{5}\|D{5}/)
  expect(await frames(), 'images sans la classe dark').not.toContain('-')
})

for (const path of [
  '/fr',
  '/en',
  '/fr/decks',
  '/fr/mentions-legales',
  '/fr/conditions-generales-de-vente',
  '/en/privacy',
  '/fr/page-inexistante',
]) {
  test(`accessibilité WCAG 2.1 AA : ${path}`, async ({ page }) => {
    await page.goto(path)
    expect(await accessibilityViolations(page)).toEqual([])
  })
}

for (const path of ['/fr', '/en', '/fr/mentions-legales', '/en/decks', '/fr/page-inexistante']) {
  test(`mobile 390 px sans débordement horizontal : ${path}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

// Every public page of the site layer and of the modules that needs no data or session: the
// deck, account and author pages are checked by their module's own specs.
const shellPages = [
  '/fr',
  '/en',
  '/fr/decks',
  '/en/decks',
  '/fr/compte/connexion',
  '/en/compte/connexion',
  '/fr/compte/supprime',
  '/fr/mentions-legales',
  '/en/legal-notice',
  '/fr/confidentialite',
  '/en/privacy',
  '/fr/page-inexistante',
  '/en/page-inexistante',
]

test('en-tête et pied de page communs sur toutes les pages publiques', async ({ page }) => {
  for (const path of shellPages) {
    await page.goto(path)
    await expect(page.getByRole('banner'), path).toHaveCount(1)
    await expect(page.getByRole('main'), path).toHaveCount(1)
    await expect(page.getByRole('contentinfo'), path).toHaveCount(1)
    const locale = path.startsWith('/en') ? 'en' : 'fr'
    await expect(page.getByRole('banner').getByRole('link', { name: 'Catalogue' })).toHaveAttribute(
      'href',
      `/${locale}/decks`,
    )
    await expect(
      page
        .getByRole('banner')
        .getByRole('link', { name: locale === 'fr' ? 'Connexion' : 'Sign in' }),
    ).toBeVisible()
  }
})

test('FR · EN mène à la même page dans l’autre langue', async ({ page }) => {
  await page.goto('/fr/mentions-legales')
  await page.getByRole('banner').getByRole('link', { name: /^EN/ }).click()
  await expect(page).toHaveURL(/\/en\/legal-notice$/)
  await page.goto('/en/decks')
  await page.getByRole('banner').getByRole('link', { name: /^FR/ }).click()
  await expect(page).toHaveURL(/\/fr\/decks$/)
})

test('le lien Catalogue de l’en-tête mène au catalogue', async ({ page }) => {
  await page.goto('/fr/mentions-legales')
  await page.getByRole('banner').getByRole('link', { name: 'Catalogue' }).click()
  await expect(page).toHaveURL(/\/fr\/decks$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('menu mobile : à 390 px, il s’ouvre et se referme au clavier', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/fr/decks')
  // The menu button only works once React has hydrated it: on a slow CI runner, pressing Enter on
  // the server-rendered button before that does nothing.
  await page.waitForLoadState('networkidle')
  const banner = page.getByRole('banner')
  // The desktop links are folded into the menu.
  await expect(banner.getByRole('link', { name: 'Catalogue' })).toBeHidden()
  const button = banner.getByRole('button', { name: 'Menu' })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  const catalogue = banner.getByRole('link', { name: 'Catalogue' })
  await expect(catalogue).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(catalogue).toBeFocused()
  expect(await accessibilityViolations(page)).toEqual([])
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
  await page.keyboard.press('Escape')
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(button).toBeFocused()
  await expect(catalogue).toBeHidden()
})

test('menu mobile : absent sur ordinateur, où les liens sont dans l’en-tête', async ({ page }) => {
  await page.goto('/fr')
  await expect(page.getByRole('banner').getByRole('button', { name: 'Menu' })).toBeHidden()
  await expect(page.getByRole('banner').getByRole('link', { name: 'Guide' })).toBeVisible()
})

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
  '/fr/decks',
  '/fr/mentions-legales',
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

test('liens internes : aucun lien du site ne mène à une page introuvable', async ({ page }) => {
  // Next.js prefetches the links in view: a link to a 404 is a broken page and a prefetch that
  // never settles. The pages of the guide are followed too, for their links to each other.
  const pages = ['/fr', '/en', '/fr/decks', '/en/decks', '/fr/mentions-legales', '/en/privacy']
  const crawled = new Set<string>()
  const checked = new Map<string, number>()
  while (pages.length) {
    const path = pages.shift() ?? ''
    if (crawled.has(path)) continue
    crawled.add(path)
    await page.goto(path)
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''))
    for (const href of hrefs) {
      const target = href.split('#')[0] ?? ''
      if (!target || checked.has(target)) continue
      const response = await page.request.get(target)
      checked.set(target, response.status())
      expect(response.status(), `${target} (lien de ${path})`).toBeLessThan(400)
      if (/^\/(fr|en)\/guide(\/|$)/.test(target)) pages.push(target)
    }
  }
  expect([...checked.keys()]).toEqual(
    expect.arrayContaining(['/fr/decks', '/fr/guide', '/fr/guide/publier-avec-github']),
  )
})

test('maintenance : visiteur gardé dehors dans le cadre du site, administrateur avec la bannière, sombre sans flash', async ({
  page,
  browser,
}) => {
  await signInAdmin(page)
  const origin = new URL(page.url()).origin
  // The administration's « Site en maintenance » box, ticked then unticked.
  const maintenance = async (on: boolean) => {
    const response = await page.request.post('/api/globals/site-settings', {
      headers: { Origin: origin },
      data: { maintenance: on },
    })
    expect(response.status(), `maintenance ${String(on)}`).toBe(200)
  }
  await maintenance(true)
  const visitors = await browser.newContext({ locale: 'fr-FR', colorScheme: 'dark' })
  try {
    const visitor = await visitors.newPage()
    const errors = pageErrors(visitor)
    for (const [path, locale] of [
      ['/fr', 'fr'],
      ['/en/decks', 'en'],
    ] as const) {
      await visitor.goto(path, { waitUntil: 'commit' })
      await visitor.waitForSelector('body', { state: 'attached' })
      expect(await isDark(visitor), path).toBe(true)
      await visitor.waitForLoadState('networkidle')
      await expect(
        visitor.getByRole('heading', { level: 1, name: messages[locale].maintenanceTitle }),
      ).toBeVisible()
      await expect(visitor.getByRole('banner')).toHaveCount(1)
      await expect(visitor.getByRole('main')).toHaveCount(1)
      await expect(visitor.getByRole('contentinfo')).toHaveCount(1)
      // No session is read for a kept-out visitor: no account entry at all.
      await expect(
        visitor.getByRole('banner').getByRole('link', { name: /Connexion|Sign in/ }),
      ).toHaveCount(0)
      expect(await accessibilityViolations(visitor), path).toEqual([])
      await visitor.setViewportSize({ width: 390, height: 844 })
      expect(await pageOverflow(visitor), path).toBeLessThanOrEqual(0)
      await visitor.setViewportSize({ width: 1280, height: 720 })
    }
    expect(errors).toEqual([])

    // The administrator sees the real site, under the banner, in the same frame.
    const adminErrors = pageErrors(page)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/fr', { waitUntil: 'commit' })
    await page.waitForSelector('body', { state: 'attached' })
    expect(await isDark(page)).toBe(true)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(messages.fr.maintenanceBanner)).toBeVisible()
    await expect(
      page.getByRole('heading', { level: 1, name: messages.fr.maintenanceTitle }),
    ).toHaveCount(0)
    await expect(page.getByRole('banner')).toHaveCount(1)
    await expect(page.getByRole('main')).toHaveCount(1)
    await expect(page.getByRole('contentinfo')).toHaveCount(1)
    expect(await accessibilityViolations(page)).toEqual([])
    expect(adminErrors).toEqual([])
  } finally {
    await visitors.close()
    await maintenance(false)
  }
})
