#!/usr/bin/env node
/**
 * Which CI checks a push needs, from the files it changes (GitHub Actions minutes are counted on
 * private repositories). The static, database and web groups always run, as does the container
 * job. The browser tests run only when what a visitor gets may change; the module removal trials
 * of the starter only when a module, a page, a test or a script does. Anything unknown (manual
 * run, first push of a branch, rewritten history) runs every one of these groups. The Lighthouse
 * budget (`performance`) never runs on a push or a pull request: performance.yml runs it once a
 * night when main changed, or by hand.
 *
 * CLI (ci.yml, job `changes`): `node scripts/ci-changes.mjs <base-sha>` prints `groups=<json>`
 * and `modules=<true|false>` for $GITHUB_OUTPUT; no base, or one git cannot diff: everything.
 * The base of a push is the last commit whose run passed every check, not the previous push: the
 * code of a failed run is checked again in full by the next one.
 */
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const allGroups = ['static', 'database', 'web', 'browser', 'performance']
/** Groups a push or a pull request may run: Lighthouse has its own nightly workflow. */
export const changeGroups = allGroups.filter((group) => group !== 'performance')

const visitor =
  /^(src\/|public\/|package\.json$|pnpm-lock\.yaml$|next\.config\.|site\.config\.json$|tests\/(e2e|support)\/|tests\/performance|tests\/run\.mjs$|playwright\.config\.|Dockerfile$|\.nvmrc$|tsconfig\.json$|postcss\.config\.)/
const modules =
  /^(src\/(modules|app|site)\/|src\/payload\.config\.|tests\/|scripts\/|package\.json$|pnpm-lock\.yaml$)/

/** @param {string[] | null} files changed paths, or null when unknown */
export function plan(files) {
  if (!files || files.length === 0) return { groups: changeGroups, modules: true }
  const browser = files.some((file) => visitor.test(file))
  return {
    groups: changeGroups.filter((group) => browser || group !== 'browser'),
    modules: files.some((file) => modules.test(file)),
  }
}

function changedFiles(base) {
  if (!base || /^0+$/.test(base)) return null
  try {
    const output = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return output.split('\n').filter(Boolean)
  } catch {
    return null
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const files = changedFiles(process.argv[2])
  const { groups, modules: trials } = plan(files)
  console.error(files ? `Changed: ${files.join(', ')}` : 'Changes unknown: everything runs.')
  console.log(`groups=${JSON.stringify(groups)}`)
  console.log(`modules=${trials}`)
}
