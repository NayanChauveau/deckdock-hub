// The files of the repository as they are in the working tree, relative to `root`: tracked and
// untracked ones, without git-ignored files and without files deleted but still in the index
// (pnpm module:remove deletes from the working tree; a fresh checkout still indexes them).
// Outside a git repository (a temporary copy), every file but dependencies, builds and .git.
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const skipped = new Set(['node_modules', '.git', '.next', '.test-build'])

/** Files under `folder` (relative to `root`), without descending into the skipped folders. */
function walk(root, folder = '') {
  return readdirSync(join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = folder ? `${folder}/${entry.name}` : entry.name
    if (entry.isDirectory()) return skipped.has(entry.name) ? [] : walk(root, path)
    return entry.isFile() ? [path] : []
  })
}

/** @param {string} [root] @returns {string[]} */
export function repositoryFiles(root = '.') {
  let listed
  try {
    listed = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    return walk(root)
  }
  // Deleted files are gone; a linked folder (an untracked node_modules link) is not a file.
  return [...new Set(listed.split('\n').filter(Boolean))].filter(
    (path) => statSync(join(root, path), { throwIfNoEntry: false })?.isFile() ?? false,
  )
}
