import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { repositoryFiles } from '../scripts/repository-files.mjs'

const roots: string[] = []
after(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.test', ...args], { cwd })

// pnpm module:remove deletes files from the working tree only: a fresh checkout (CI) still has
// them in the index. The repository's file scans read the working tree.
void test('repository files: tracked and untracked files of the working tree, not deleted ones', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repository-files-'))
  roots.push(root)
  await mkdir(join(root, 'src'))
  await writeFile(join(root, 'src', 'kept.ts'), '')
  await writeFile(join(root, 'src', 'gone.ts'), '')
  await writeFile(join(root, '.gitignore'), 'ignored.txt\n')
  git(root, 'init', '-q')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'initial')
  await rm(join(root, 'src', 'gone.ts'))
  await writeFile(join(root, 'src', 'new.ts'), '')
  await writeFile(join(root, 'ignored.txt'), '')
  // A linked folder (node_modules shared with another checkout) is listed by git, not a file.
  await symlink(join(root, 'src'), join(root, 'linked'))
  assert.deepEqual(repositoryFiles(root).sort(), ['.gitignore', 'src/kept.ts', 'src/new.ts'])
})

void test('repository files: outside a git repository, every file but dependencies and builds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'repository-files-'))
  roots.push(root)
  for (const folder of ['src', 'node_modules/x', '.next', '.test-build'])
    await mkdir(join(root, folder), { recursive: true })
  for (const file of ['src/a.ts', 'node_modules/x/b.js', '.next/c.js', '.test-build/d.js', 'e.md'])
    await writeFile(join(root, file), '')
  assert.deepEqual(repositoryFiles(root).sort(), ['e.md', 'src/a.ts'])
})

void test('the browser suite output folder, which may hold a test administrator, is git-ignored', async () => {
  const { readFile } = await import('node:fs/promises')
  const lines = (await readFile(new URL('../.gitignore', import.meta.url), 'utf8')).split('\n')
  assert.ok(lines.includes('test-results/'))
})
