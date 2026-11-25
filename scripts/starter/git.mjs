// Git access for scripts/starter-update.mjs: the starter cloned into a temporary directory, files
// read at any version. Standard library and the git CLI only.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const run = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/**
 * Where to clone the starter from: a path (absolute, or starting with `.`), a URL (`https:`,
 * `ssh:`, `git@…`) as is, `owner/name` from GitHub over HTTPS.
 * @public
 * @param {string} repository
 */
export function repositoryUrl(repository) {
  if (/^(\/|\.)/.test(repository) || /^(https?:|ssh:|git@)/.test(repository)) return repository
  return `https://github.com/${repository}.git`
}

/**
 * Clones the starter: a local directory as is (tests, offline work), `owner/name` from GitHub over
 * HTTPS with the workstation's own credentials. Files are read from git, never checked out.
 * @param {string} repository @returns {{ dir: string, cleanup(): void }}
 */
export function fetchStarter(repository) {
  const url = repositoryUrl(repository)
  const dir = mkdtempSync(join(tmpdir(), 'starter-'))
  // A full clone (the starter is small): every file read afterwards is local, so a network error
  // can never pass for a file the starter deleted.
  const args = ['clone', '--quiet', '--no-checkout']
  const result = spawnSync('git', [...args, url, dir], { encoding: 'utf8' })
  if (result.status !== 0) {
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`Starter injoignable (${url}) : ${result.stderr.trim()}`)
  }
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** @param {string} dir @param {string} ref @returns {string} the full commit SHA */
export function resolveRef(dir, ref) {
  try {
    return run(dir, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).trim()
  } catch {
    throw new Error(`Version du starter introuvable : ${ref}`)
  }
}

/** Whether `path` exists at `rev`. */
function has(dir, rev, path) {
  return spawnSync('git', ['cat-file', '-e', `${rev}:${path}`], { cwd: dir }).status === 0
}

/** The file's bytes at `rev`, or null when it does not exist there; any other failure throws. */
export function show(dir, rev, path) {
  if (!has(dir, rev, path)) return null
  const result = spawnSync('git', ['cat-file', 'blob', `${rev}:${path}`], {
    cwd: dir,
    maxBuffer: 256 * 1024 * 1024,
  })
  if (result.status !== 0) throw new Error(`Lecture impossible : ${rev.slice(0, 7)}:${path}`)
  return result.stdout
}

/** The paths at `rev` whose mode is executable (100755). */
export function executables(dir, rev) {
  return new Set(
    run(dir, ['ls-tree', '-r', '-z', rev])
      .split('\0')
      .filter((entry) => entry.startsWith('100755 '))
      .map((entry) => entry.slice(entry.indexOf('\t') + 1)),
  )
}

/** @returns {string[]} every file path at `rev` */
export function listFiles(dir, rev) {
  return run(dir, ['ls-tree', '-r', '--name-only', '-z', rev]).split('\0').filter(Boolean)
}

/** @returns {string[]} `<sha7> <subject>` of the commits after `base` up to `target` */
export function log(dir, base, target) {
  return run(dir, ['log', '--format=%h %s', `${base}..${target}`])
    .split('\n')
    .filter(Boolean)
}

/**
 * Whether the repository at `dir` has no uncommitted change (untracked files included), apart from
 * the paths in `except` (the tool's own record, written by `adopt` just before an update).
 */
export function isClean(dir, except = []) {
  return run(dir, ['status', '--porcelain', '-z'])
    .split('\0')
    .filter(Boolean)
    .every((entry) => except.includes(entry.slice(3)))
}

/**
 * The last `count` commits of `rev` with their tree hash: `[{ commit, tree }]`, newest first
 * (scripts/init-site.mjs, starter only).
 * @public
 */
export function commitsWithTrees(dir, rev, count) {
  return run(dir, ['log', `-${count}`, '--format=%H %T', rev])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [commit, tree] = line.split(' ')
      return { commit, tree }
    })
}
