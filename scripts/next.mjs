// Starts `next dev` or `next start` on the port of the site configuration (site.config.json),
// forwarding any extra argument and the exit code.
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'

const [mode, ...rest] = process.argv.slice(2)
if (mode !== 'dev' && mode !== 'start') {
  console.error('Usage : node scripts/next.mjs <dev|start> [arguments de next]')
  process.exit(2)
}
const { app } = JSON.parse(await readFile('site.config.json', 'utf8'))
// The Next.js binary itself, so this works with or without `pnpm` putting node_modules/.bin on PATH.
const child = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', mode, '--port', String(app.port), ...rest],
  { stdio: 'inherit' },
)
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
