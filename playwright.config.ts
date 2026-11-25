import { defineConfig, devices } from '@playwright/test'

// Started by tests/run.mjs against an isolated server; E2E_ORIGIN is never a shared or production URL.
const origin = process.env['E2E_ORIGIN']
if (!origin)
  throw new Error('E2E_ORIGIN est requis : lancer les tests navigateur avec `pnpm test`.')

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  // The isolated dev server compiles each route on first use; CI runners need more than the 5 s default.
  expect: { timeout: 20_000 },
  reporter: [['list']],
  outputDir: process.env['E2E_OUTPUT_DIR'] || 'test-results',
  use: { baseURL: origin, locale: 'fr-FR', trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
