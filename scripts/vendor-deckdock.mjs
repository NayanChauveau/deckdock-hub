// Copies the deckdock checker library (Python) into vendor/deckdock, from the sibling checkout of
// NayanChauveau/deckdock: the production image installs it from there (Dockerfile), so the build
// never fetches it from the network. Run it again, then commit, to move to a newer library.
//
//   node scripts/vendor-deckdock.mjs [--source ../deckdock]
//
// Only the package itself is copied (.py files and py.typed, no __pycache__), and
// vendor/deckdock/SOURCE records the commit it came from.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { source: { type: 'string', default: '../deckdock' } } })
const checkout = resolve(values.source)
const library = join(checkout, 'cli/src/deckdock')
const target = resolve('vendor/deckdock')
const packageDir = join(target, 'deckdock')

if (!existsSync(join(library, '__main__.py'))) {
  console.error(`Bibliothèque deckdock introuvable : ${library} (option --source).`)
  process.exit(1)
}
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim()
const commit = git('rev-parse', 'HEAD')
const changed = git('status', '--porcelain', '--', 'cli/src/deckdock')

/** Relative paths of the files to copy: .py and py.typed, never caches. */
function packageFiles(folder = '') {
  return readdirSync(join(library, folder), { withFileTypes: true }).flatMap((entry) => {
    const path = folder ? `${folder}/${entry.name}` : entry.name
    if (entry.isDirectory()) return entry.name === '__pycache__' ? [] : packageFiles(path)
    return entry.isFile() && (entry.name.endsWith('.py') || entry.name === 'py.typed') ? [path] : []
  })
}

rmSync(packageDir, { recursive: true, force: true })
const files = packageFiles()
for (const path of files) {
  mkdirSync(join(packageDir, path, '..'), { recursive: true })
  cpSync(join(library, path), join(packageDir, path))
}
writeFileSync(join(target, 'SOURCE'), `NayanChauveau/deckdock ${commit} cli/src/deckdock\n`)
console.log(`vendor/deckdock : ${files.length} fichiers copiés depuis ${commit.slice(0, 12)}.`)
if (changed)
  console.warn(
    'Attention : la copie de travail de deckdock a des modifications non commitées dans cli/src/deckdock ; SOURCE ne les décrit pas.',
  )
