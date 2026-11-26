import { execFile } from 'node:child_process'
import type { NotetypeChange } from '../../application/publish'

/** One issue of `deckdock check --json`. */
export interface CheckIssue {
  path: string
  where: string
  message: string
  line: number | null
}

/** The official deckdock library, run as `python3 -m deckdock` (vendor/deckdock, /opt/deckdock). */
export interface DeckdockChecker {
  /** `check --non-strict --json` on a dist directory (`<dist>/<edition>/deck.json`). */
  check(distDir: string): Promise<CheckIssue[]>
  /** `compat PREVIOUS NEW --json`: the structure changes of the notetypes found in both. */
  compat(previousDeckJson: string, newDeckJson: string): Promise<NotetypeChange[]>
}

/** A checker that failed to run or answered something unreadable: a server error, never shown. */
export class CheckerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CheckerError'
  }
}

/**
 * The checker ran out of its address space (`MemoryError` under the limit): the deck.json is too
 * complex to check, a refusal (422) rather than a server error.
 */
export class CheckerOutOfMemory extends Error {
  constructor(command: string) {
    super(`deckdock ${command}: out of memory`)
    this.name = 'CheckerOutOfMemory'
  }
}

/**
 * Address space of one checker process (768 MiB, more than its resident memory, which stays lower).
 * A valid deck.json of at most 16 MiB is checked well within it (even 16 MiB of `[[],[],…]` is);
 * one built to blow up the parser stops with a MemoryError instead of exhausting the 1.5 GB
 * container that two checkers (the publish slots) share with the site.
 */
export const CHECKER_MAX_MEMORY_BYTES = 768 * 1024 * 1024

/** Exit status of the launcher when the checker raised MemoryError. */
const OUT_OF_MEMORY_EXIT = 3

/**
 * `python3 -P -c LAUNCHER <args>`: limits the address space, then runs `deckdock` as `-m` would.
 * The limit is mandatory on Linux (the image); macOS cannot lower RLIMIT_AS, so development runs
 * there without it.
 */
const launcher = (maxMemoryBytes: number) =>
  [
    'import resource, runpy, sys',
    'try:',
    `    resource.setrlimit(resource.RLIMIT_AS, (${maxMemoryBytes}, ${maxMemoryBytes}))`,
    'except (ValueError, OSError):',
    "    if sys.platform != 'darwin':",
    '        raise',
    'try:',
    "    runpy.run_module('deckdock', run_name='__main__', alter_sys=True)",
    'except MemoryError:',
    `    sys.exit(${OUT_OF_MEMORY_EXIT})`,
  ].join('\n')

const get = (value: unknown, key: string): unknown =>
  typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/**
 * The interpreter is `HUB_PYTHON` (default `python3`, the image's 3.13). It finds the library on
 * `PYTHONPATH` (`/opt/deckdock` in the image, `vendor/deckdock` in development and tests). It runs
 * with `-P` (no current directory on `sys.path`, so nothing uploaded can be imported) and with a
 * minimal environment: none of the site's secrets reach it. Its address space is limited to
 * `maxMemoryBytes` (see `launcher`).
 */
export function pythonChecker(
  env: Record<string, string | undefined> = process.env,
  timeoutMs = 120_000,
  maxMemoryBytes = CHECKER_MAX_MEMORY_BYTES,
): DeckdockChecker {
  const python = env['HUB_PYTHON'] || 'python3'
  const childEnv = {
    PATH: env['PATH'] ?? '/usr/local/bin:/usr/bin:/bin',
    PYTHONPATH: env['PYTHONPATH'] ?? '',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONIOENCODING: 'utf-8',
    LANG: 'C.UTF-8',
  } as unknown as NodeJS.ProcessEnv

  /** stdout of a run that exited 0 or 1 (both carry JSON with --json); anything else throws. */
  const run = (args: string[]) =>
    new Promise<string>((resolve, reject) => {
      execFile(
        python,
        ['-P', '-c', launcher(maxMemoryBytes), ...args],
        { env: childEnv, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' },
        (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => {
          const code = error ? error.code : 0
          if (code === 0 || code === 1) {
            resolve(stdout)
            return
          }
          if (code === OUT_OF_MEMORY_EXIT) {
            reject(new CheckerOutOfMemory(args[0] ?? ''))
            return
          }
          const detail = stderr.trim().split('\n').at(-1) ?? ''
          reject(new CheckerError(`deckdock ${args[0]} failed (${String(code)}): ${detail}`))
        },
      )
    })
  const parse = (command: string, stdout: string): unknown => {
    try {
      return JSON.parse(stdout)
    } catch {
      throw new CheckerError(`deckdock ${command}: no JSON on stdout`)
    }
  }

  return {
    async check(distDir) {
      const report = parse('check', await run(['check', '--non-strict', '--json', distDir]))
      const issues = get(report, 'issues')
      if (typeof get(report, 'ok') !== 'boolean' || !Array.isArray(issues))
        throw new CheckerError('deckdock check: unexpected report')
      return issues.map((issue) => {
        const line = get(issue, 'line')
        return {
          path: text(get(issue, 'path')),
          where: text(get(issue, 'where')),
          message: text(get(issue, 'message')),
          line: typeof line === 'number' ? line : null,
        }
      })
    },
    async compat(previousDeckJson, newDeckJson) {
      // Both files were checked: an unreadable one (printed as text, not JSON) is a server error.
      const changes = parse(
        'compat',
        await run(['compat', previousDeckJson, newDeckJson, '--json']),
      )
      if (!Array.isArray(changes)) throw new CheckerError('deckdock compat: unexpected report')
      return changes.map((change) => {
        const kind = get(change, 'kind')
        if (kind !== 'appended_fields' && kind !== 'breaking')
          throw new CheckerError(`deckdock compat: unknown kind ${String(kind)}`)
        return {
          notetype: text(get(change, 'notetype')),
          kind,
          detail: text(get(change, 'detail')),
        }
      })
    },
  }
}
