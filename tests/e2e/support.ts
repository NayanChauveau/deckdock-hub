import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { totpCode } from '../support/totp'

/** Content Security Policy violations seen by the browser in the current test (src/core/http/csp.ts). */
const cspViolations = new WeakMap<Page, string[]>()

function watchCsp(page: Page) {
  const seen: string[] = []
  cspViolations.set(page, seen)
  page.on('console', (message) => {
    // A card preview's own policy refuses the author's scripts by design (decks module,
    // preview-route.ts): its document runs in a sandbox, not in the site's pages.
    if (
      new URL(message.location().url || 'about:blank', page.url()).pathname.startsWith('/preview/')
    )
      return
    if (message.type() === 'error' && /Content Security Policy/i.test(message.text()))
      seen.push(`${page.url()}: ${message.text()}`)
  })
  page.on('request', (request) => {
    if (request.url().endsWith('/api/csp-report'))
      seen.push(`${page.url()}: report ${request.postData()}`)
  })
}

/** Hooks every spec file installs: no public provider reached, no CSP violation on any page. */
export function guardEveryPage() {
  // Address suggestions call public providers; the browser suite never reaches them.
  test.beforeEach(async ({ page, context }) => {
    await page.route('**/api/addresses', (route) => route.fulfill({ json: { suggestions: [] } }))
    // Every page of every test, other tabs included, must run under the CSP without a violation.
    watchCsp(page)
    context.on('page', watchCsp)
  })

  test.afterEach(async ({ context }) => {
    const all = context.pages().flatMap((page) => cspViolations.get(page) ?? [])
    expect(all, 'Violations de la Content Security Policy').toEqual([])
  })
}

/**
 * Browser administrator, created by the first test that needs it and reused by the others. Kept in
 * the run's output folder (emptied by Playwright at the start of each run): after a failed test,
 * Playwright starts a new worker process, which signs in again instead of registering twice.
 */
const adminFile = join(process.env['E2E_OUTPUT_DIR'] || 'test-results', 'browser-admin.json')
export const admin: { email: string; password: string; secret: string } = existsSync(adminFile)
  ? (JSON.parse(readFileSync(adminFile, 'utf8')) as {
      email: string
      password: string
      secret: string
    })
  : { email: 'browser-admin@example.test', password: randomBytes(24).toString('hex'), secret: '' }

/** Typed into the six boxes of the payload-totp form, which submits itself once filled. */
export async function typeTotpCode(page: Page, secret: string) {
  await page.waitForLoadState('networkidle')
  await page.locator('form input[type="text"][maxlength="1"]').first().click()
  await page.keyboard.type(totpCode(secret))
}

/** First sign-in: the setup view shows the key, as an authenticator app or password manager reads it. */
export async function enrolTotp(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/admin\/setup-totp/)
  await expect(page.getByText('gestionnaire de mots de passe')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.getByRole('button', { name: 'Ajouter le code manuellement' }).click()
  const secret = (await page.locator('code').first().innerText()).replace(/\s/g, '')
  expect(secret).toMatch(/^[A-Z2-7]{32,}$/)
  await typeTotpCode(page, secret)
  await expect(page).not.toHaveURL(/setup-totp/)
  return secret
}

/**
 * Signs the administrator in, with the second factor: the first call creates the first account
 * and enrols it, the next ones sign in with the password and a TOTP code.
 */
export async function signInAdmin(page: Page) {
  if (!admin.secret) {
    const registration = await page.request.post('/api/users/first-register', {
      data: { email: admin.email, name: 'Administration navigateur', password: admin.password },
    })
    expect(registration.ok()).toBe(true)
    // Signed in by the password only: the administration first requires the TOTP enrolment.
    await page.goto('/admin')
    admin.secret = await enrolTotp(page)
    mkdirSync(dirname(adminFile), { recursive: true })
    writeFileSync(adminFile, JSON.stringify(admin), { mode: 0o600 })
    return
  }
  await page.goto('/admin/login')
  await page.waitForLoadState('networkidle')
  await page.getByLabel('E-mail').fill(admin.email)
  await page.getByLabel('Mot de passe', { exact: true }).fill(admin.password)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/\/admin\/verify-totp/)
  await typeTotpCode(page, admin.secret)
  await expect(page).not.toHaveURL(/verify-totp/)
}

export async function accessibilityViolations(page: Page) {
  // After a theme switch (emulateMedia) the page follows on the client (ThemeSync, once hydrated),
  // then its colours animate for a moment. axe must measure the final colours: wait until <html>
  // shows the theme the preference asks for, then until no transition is running (a false contrast
  // failure on slower CI runners otherwise).
  await page.waitForFunction(() => {
    // The administration keeps Payload's own theme: nothing to wait for there.
    if (window.location.pathname.startsWith('/admin')) return true
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem('site-theme')
    } catch {
      stored = null
    }
    const dark =
      stored === 'dark' ||
      (stored !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches)
    return document.documentElement.classList.contains('dark') === dark
  })
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  await page.waitForFunction(() => document.getAnimations().length === 0)
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  return violations.map(
    (violation) =>
      `${violation.impact ?? 'unknown'} ${violation.id}: ${violation.nodes
        .map((node) => node.target.join(' '))
        .slice(0, 3)
        .join(' | ')}`,
  )
}

/**
 * The page's script errors and console errors from now on (a hydration mismatch is one): the array
 * fills as the page runs. A 404 page's own response is not an error of the page.
 */
export function pageErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('status of 404'))
      errors.push(`${page.url()}: ${message.text()}`)
  })
  return errors
}

/** Horizontal overflow of the page, in pixels (0 or less: nothing sticks out). */
export const pageOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
