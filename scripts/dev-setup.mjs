// `pnpm dev:setup`: a fresh clone ready for `pnpm dev` in one command. Creates `.env` from
// `.env.example` with a generated PAYLOAD_SECRET when no environment file exists (never overwrites
// one), starts the local PostgreSQL, migrates, seeds, turns maintenance off and creates the local
// administrator (src/scripts/dev-admin.ts), whose password is printed. That administrator signs in
// without the second factor only under `next dev`, on a local `_dev` database, with the flag added
// here to the environment file (see localDevelopmentWithoutTotp in src/core/admin/totp.ts).
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from 'dotenv'

export const bypassFlag = 'PAYLOAD_TOTP_LOCAL_DEV_BYPASS'
const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * A PostgreSQL database on this machine whose name ends with `_dev` (same rule as
 * isLocalDevDatabase in src/core/admin/totp.ts; tests/dev-setup.test.ts checks they agree).
 * @param {string | undefined} connectionString
 */
export function isLocalDevDatabase(connectionString) {
  let database
  try {
    database = new URL(connectionString ?? '')
  } catch {
    return false
  }
  return (
    ['postgres:', 'postgresql:'].includes(database.protocol) &&
    localHosts.has(database.hostname) &&
    /^\/[A-Za-z0-9_]+_dev$/.test(database.pathname)
  )
}

/**
 * The environment file of this clone, created if missing, with the local flag. Refuses, before
 * writing anything, a database that is not a local `_dev` one or a missing or placeholder secret.
 * Values of the process environment win over the files, as for Next.js and Payload.
 * @param {string} root
 * @param {Record<string, string | undefined>} environment
 * @returns {{ file: string, created: boolean, flagAdded: boolean }}
 */
export function prepareEnvironment(root, environment) {
  const example = readFileSync(join(root, '.env.example'), 'utf8')
  const placeholder = /^PAYLOAD_SECRET=(.*)$/m.exec(example)?.[1]
  const file = existsSync(join(root, '.env.local')) ? '.env.local' : '.env'
  const path = join(root, file)
  const created = !existsSync(path)
  const content = created
    ? example.replace(/^PAYLOAD_SECRET=.*$/m, `PAYLOAD_SECRET=${randomBytes(48).toString('hex')}`)
    : readFileSync(path, 'utf8')
  const fromFiles = Object.assign(
    {},
    ...['.env', '.env.local'].map((name) =>
      name === file
        ? parse(content)
        : existsSync(join(root, name))
          ? parse(readFileSync(join(root, name)))
          : {},
    ),
  )
  const value = (/** @type {string} */ key) => environment[key] ?? fromFiles[key]
  if (!isLocalDevDatabase(value('DATABASE_URL')))
    throw new Error(
      'DATABASE_URL doit désigner une base locale (localhost ou 127.0.0.1) dont le nom finit par _dev. Rien n’a été modifié.',
    )
  const secret = value('PAYLOAD_SECRET') ?? ''
  if (secret.length < 32 || secret === placeholder)
    throw new Error(
      `PAYLOAD_SECRET de ${file} absent ou encore la valeur d’exemple : le remplacer (openssl rand -hex 48), puis relancer.`,
    )
  if (created) writeFileSync(path, content, { mode: 0o600 })
  const flagAdded = !new RegExp(`^${bypassFlag}=`, 'm').test(content)
  if (flagAdded)
    appendFileSync(
      path,
      `${content.endsWith('\n') ? '' : '\n'}# pnpm dev:setup : administrateur local sans double authentification (next dev et base locale _dev uniquement)\n${bypassFlag}=true\n`,
    )
  return { file, created, flagAdded }
}

/** @param {string[]} args */
function pnpm(args) {
  const result = spawnSync('pnpm', args, { stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} a échoué.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { file, created, flagAdded } = prepareEnvironment('.', process.env)
    console.log(
      created
        ? `${file} créé depuis .env.example, avec un PAYLOAD_SECRET généré.`
        : `${file} existant conservé${flagAdded ? ` (ligne ${bypassFlag}=true ajoutée)` : ''}.`,
    )
    pnpm(['db:start'])
    pnpm(['db:migrate'])
    pnpm(['db:seed'])
    pnpm(['payload', 'run', 'src/scripts/dev-admin.ts'])
    console.log('\nPrêt : pnpm dev')
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
