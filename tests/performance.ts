// Lighthouse on the key public pages of the production build (`pnpm test --group=performance`).
// Started by tests/run.mjs against its isolated `next start` server; the budget and the pages live in
// tests/support/performance-budget.ts. Chromium is Playwright's own (`pnpm exec playwright install chromium`).
import { appendFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { chromium, type BrowserContext } from '@playwright/test'
import lighthouse from 'lighthouse'
import {
  categories,
  failingAudits,
  measure,
  median,
  pages,
  table,
  violations,
  type BudgetPage,
  type LighthouseResult,
  type Measure,
} from './support/performance-budget'
import { answerAnalytics } from './support/analytics-stub'
import { site } from '../src/core/site'

const origin = process.env['TEST_ORIGIN']
if (!origin || !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
  throw new Error('TEST_ORIGIN local requis : lancer `pnpm test --group=performance`.')
const runs = Number(process.env['PERFORMANCE_RUNS'] || 3)

async function freePort() {
  const server = createServer()
  await new Promise<void>((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  const address = server.address()
  await new Promise((done) => server.close(done))
  if (!address || typeof address === 'string') throw new Error('Port local indisponible')
  return address.port
}

/**
 * The production build loads the audience measurement when site.config.json configures it: first
 * check it runs under the Content Security Policy (tag nonced, visit posted, no violation), then
 * measure with it. The host is answered by tests/support/analytics-stub.ts, never the network.
 */
async function checkAnalytics(context: BrowserContext, sent: unknown[]) {
  const page = await context.newPage()
  const violations: string[] = []
  await page.exposeFunction('__cspViolation', (line: string) => violations.push(line))
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      ;(window as unknown as { __cspViolation(line: string): void }).__cspViolation(
        `${event.effectiveDirective} ${event.blockedURI}`,
      )
    })
  })
  await page.goto(`${origin ?? ''}/fr?utm_source=budget&adresse=private`)
  for (let wait = 0; sent.length === 0 && wait < 50; wait++) await page.waitForTimeout(200)
  await page.close()
  const url = (sent[0] as { payload?: { url?: string } } | undefined)?.payload?.url ?? ''
  if (violations.length || !url.endsWith('/fr?utm_source=budget'))
    throw new Error(`Mesure d’audience : ${JSON.stringify({ violations, sent })}`)
}

/**
 * Content Security Policy issues Chrome reports on a page (its Issues panel), even when nothing
 * visibly breaks: a caught `new Function` probe, for instance, costs the best practices score.
 */
async function cspIssues(context: BrowserContext, path: string) {
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const issues: string[] = []
  cdp.on('Audits.issueAdded', ({ issue }) => {
    const details = issue.details.contentSecurityPolicyIssueDetails
    if (issue.code === 'ContentSecurityPolicyIssue' && details)
      issues.push(
        `${path} : ${details.contentSecurityPolicyViolationType} ${details.violatedDirective} ${details.sourceCodeLocation?.url ?? details.blockedURL ?? ''}`,
      )
  })
  await cdp.send('Audits.enable')
  await page.goto(`${origin ?? ''}${path}`, { waitUntil: 'networkidle' })
  await page.close()
  return issues
}

const port = await freePort()
// Full Chromium in new headless mode (not the headless shell), reachable by Lighthouse over CDP; a
// persistent context, so that its routes also apply to the tab Lighthouse opens.
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  viewport: null,
  args: [`--remote-debugging-port=${String(port)}`],
})
const rows: { page: BudgetPage; result: Measure; problems: string[] }[] = []
const policyIssues: string[] = []
try {
  const { sent } = await answerAnalytics(context, site.analytics?.host)
  if (site.analytics) await checkAnalytics(context, sent)
  for (const page of pages) policyIssues.push(...(await cspIssues(context, page.path)))
  for (const page of pages) {
    const measures: Measure[] = []
    let last: LighthouseResult | undefined
    for (let run = 0; run < runs; run++) {
      const result = await lighthouse(`${origin}${page.path}`, {
        port,
        logLevel: 'error',
        output: 'json',
        onlyCategories: [...categories],
      })
      if (!result) throw new Error(`Lighthouse sans résultat : ${page.path}`)
      last = result.lhr
      measures.push(measure(last))
    }
    const result = median(measures)
    const problems = violations(result, page)
    if (problems.length && last)
      for (const category of categories)
        console.log(`${page.path} ${category} : ${failingAudits(last, category).join(', ') || '—'}`)
    rows.push({ page, result, problems })
  }
} finally {
  await context.close()
}

const summary = `Budget de performance (Lighthouse mobile, médiane de ${String(runs)} mesures)\n\n${table(rows)}\n`
console.log(summary)
if (process.env['PERFORMANCE_REPORT']) await writeFile(process.env['PERFORMANCE_REPORT'], summary)
if (process.env['GITHUB_STEP_SUMMARY'])
  await appendFile(process.env['GITHUB_STEP_SUMMARY'], summary)
if (policyIssues.length) {
  console.error(
    `Problème(s) de Content Security Policy signalé(s) par Chrome :\n${policyIssues.join('\n')}`,
  )
  process.exitCode = 1
}
if (rows.some((row) => row.problems.length)) {
  console.error('Page(s) hors budget de performance.')
  process.exitCode = 1
}
