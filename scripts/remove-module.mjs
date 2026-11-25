// Removes optional modules from this site: `pnpm module:remove [--delete-migrations] <module> [<module>…]`.
// Deletes src/modules/<module>, its registry line (src/modules/index.ts), the files its manifest
// lists (`routes`, `files`), its import map entries, the package scripts that only ran those files,
// its site.config.json settings (payments off without payments-stripe), the deploy secrets only it
// reads (manifest `secrets`: site.config.json, workflows, docker-compose.prod.yml, .env.example and
// the deploy fixtures; the site's deploy plan re-recorded) and its piece in .starter.json; then
// prints what is left to do (generated files, migration, mentions).
// --delete-migrations, internal to init-site (refused once .starter.json exists): the migrations of a
// module the new site never deployed (manifest `migrations`) go too, instead of a removal migration.
// Refuses a name that is not a registered module, or a module another kept module depends on.
// Runs under tsx (the manifests are TypeScript): see the module:remove script of package.json.
import { existsSync } from 'node:fs'
import { readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { jobPurgeStatements, taskSlugs } from './module-removal.mjs'

const fail = (message, code = 1) => {
  console.error(message)
  process.exit(code)
}
const args = process.argv.slice(2)
const flags = args.filter((arg) => arg.startsWith('--'))
const deleteMigrations = flags.includes('--delete-migrations')
for (const flag of flags)
  if (flag !== '--delete-migrations') fail(`Option inconnue : ${flag} (--delete-migrations).`, 2)
// Internal to init-site, which runs it before writing .starter.json: an initialised site may have
// deployed the module, and deleting its migrations would leave its tables (visitor data included)
// in production with nothing left to remove them.
if (deleteMigrations && existsSync('.starter.json'))
  fail(
    '--delete-migrations est réservé à init-site (site jamais initialisé) : ce site a un .starter.json. Retirer le module sans cette option, puis écrire la migration de retrait.',
    2,
  )
const names = [...new Set(args.filter((arg) => !arg.startsWith('--')))]
if (!names.length) fail('Usage : pnpm module:remove [--delete-migrations] <module> [<module>…]', 2)

const load = (path) => import(pathToFileURL(resolve(path)).href)
let modules, importedPaths
try {
  ;({ modules } = await load('src/modules/index.ts'))
  ;({ importedPaths } = await load('tests/support/architecture.ts'))
} catch (error) {
  fail(`Registre des modules illisible (lancer avec pnpm module:remove) : ${error.message}`)
}

const byName = new Map(modules.map((entry) => [entry.name, entry]))
for (const name of names)
  if (!byName.has(name))
    fail(
      `${name} n’est pas un module optionnel de ce site. Modules : ${[...byName.keys()].join(', ')}.`,
    )
const removed = names.map((name) => byName.get(name))
const kept = modules.filter((entry) => !names.includes(entry.name))
const dependents = kept.filter((entry) => entry.dependsOn.some((name) => names.includes(name)))
if (dependents.length)
  fail(
    dependents
      .map(
        (entry) =>
          `Retrait refusé : ${entry.name} dépend de ${entry.dependsOn.filter((name) => names.includes(name)).join(', ')}.`,
      )
      .concat(
        `Retirer aussi les modules qui en dépendent : pnpm module:remove ${[
          ...dependents.map((entry) => entry.name),
          ...names,
        ].join(' ')}`,
      )
      .join('\n'),
  )

// What goes: the module folders and the files their manifests list.
const folders = names.map((name) => `src/modules/${name}`)
const files = removed.flatMap((entry) => [...(entry.routes ?? []), ...(entry.files ?? [])])
const withoutExtension = (path) => path.replace(/\.(ts|tsx|mjs|js)$/, '')
const deleted = new Set(files.map(withoutExtension))
const goes = (path) =>
  folders.some((folder) => path === folder || path.startsWith(`${folder}/`)) ||
  deleted.has(withoutExtension(path))

// Every kept file must stop importing what goes, before anything is deleted.
async function sourceFiles(root) {
  if (!existsSync(root)) return []
  const entries = await readdir(root, { withFileTypes: true, recursive: true })
  return entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
}
const broken = []
for (const path of [...(await sourceFiles('src')), ...(await sourceFiles('tests'))]) {
  if (goes(path) || path === 'src/modules/index.ts') continue
  for (const to of importedPaths(path, await readFile(path, 'utf8')))
    if (goes(to)) broken.push(`${path} importe ${to}`)
}
if (broken.length)
  fail(
    [
      'Retrait refusé : des fichiers conservés importent ce qui serait supprimé.',
      ...broken.map((line) => `  ${line}`),
      'Les ajouter au manifeste du module (`files`) ou retirer ces imports, puis relancer.',
    ].join('\n'),
  )

// Registry: the import line and the array entry of each module.
let registry = await readFile('src/modules/index.ts', 'utf8')
for (const name of names) {
  const line = new RegExp(`^import \\{ (\\w+) \\} from '\\./${name}/module'\\n`, 'm')
  const identifier = line.exec(registry)?.[1]
  if (!identifier) fail(`src/modules/index.ts : import de ${name} introuvable`)
  registry = registry.replace(line, '').replace(new RegExp(`^\\s*${identifier},?\\n`, 'm'), '')
  if (registry.includes(identifier))
    fail(`src/modules/index.ts : ${identifier} encore présent, retirer la ligne à la main`)
}

// Deletion, then the folders left empty (never src/app, tests or their direct children).
for (const folder of folders) await rm(folder, { recursive: true, force: true })
for (const file of files) await rm(file, { force: true })
// The registry keeps the repository's formatting (prettier, as `pnpm format`).
const prettier = await import('prettier')
const registryOptions = { ...(await prettier.resolveConfig('src/modules/index.ts')) }
await writeFile(
  'src/modules/index.ts',
  await prettier.format(registry, { ...registryOptions, filepath: 'src/modules/index.ts' }),
)
for (const file of files) {
  let folder = dirname(file)
  while (folder.split('/').length > 2 && existsSync(folder) && !(await readdir(folder)).length) {
    await rmdir(folder)
    folder = dirname(folder)
  }
}

// Generated import map: its entries for the removed admin components (regenerated by Payload).
const importMap = 'src/app/(payload)/admin/importMap.js'
if (existsSync(importMap)) {
  const lines = (await readFile(importMap, 'utf8')).split('\n')
  const keep = lines.filter((line) => !names.some((name) => line.includes(`/modules/${name}/`)))
  if (keep.length !== lines.length) await writeFile(importMap, keep.join('\n'))
}

// Migrations, for a site that never deployed the module: files and entries of src/migrations/index.ts.
const migrations = removed.flatMap((entry) => entry.migrations ?? [])
const migrationIndex = 'src/migrations/index.ts'
if (deleteMigrations && migrations.length) {
  let index = await readFile(migrationIndex, 'utf8')
  for (const name of migrations) {
    for (const extension of ['ts', 'json'])
      await rm(`src/migrations/${name}.${extension}`, { force: true })
    index = index
      .replace(new RegExp(`^import \\* as migration_${name} from '\\./${name}'\\n`, 'm'), '')
      .replace(
        new RegExp(`\\s*\\{\\s*up: migration_${name}\\.up,[^}]*name: '${name}',\\s*\\},?`),
        '',
      )
    if (index.includes(name))
      fail(`${migrationIndex} : ${name} encore présente, la retirer à la main`)
  }
  await writeFile(
    migrationIndex,
    await prettier.format(index, {
      ...(await prettier.resolveConfig(migrationIndex)),
      filepath: migrationIndex,
    }),
  )
}

// Site configuration: the removed modules' settings go; without payments-stripe the site takes no
// payment (deploy.payments false: the deploy kit no longer asks for the Stripe secrets). The
// shared deploy workflow still names the STRIPE_* secrets: they stay listed, unused.
const siteConfig = JSON.parse(await readFile('site.config.json', 'utf8'))
const configChanges = []
for (const name of names)
  if (siteConfig.modules && name in siteConfig.modules) {
    delete siteConfig.modules[name]
    configChanges.push(`modules.${name}`)
  }
if (names.includes('payments-stripe') && siteConfig.deploy?.payments) {
  siteConfig.deploy.payments = false
  configChanges.push('deploy.payments = false')
}
// The deploy secrets only the removed modules read (their manifests' `secrets`).
const keptSecrets = new Set(kept.flatMap((entry) => entry.secrets ?? []))
const secrets = [...new Set(removed.flatMap((entry) => entry.secrets ?? []))].filter(
  (name) => !keptSecrets.has(name),
)
for (const [key, list] of [
  ['deploy.requiredSecrets', siteConfig.deploy?.requiredSecrets],
  ['deploy.optionalSecrets', siteConfig.deploy?.optionalSecrets],
  ['github.secrets', siteConfig.github?.secrets],
]) {
  if (!Array.isArray(list)) continue
  const left = list.filter((name) => !secrets.includes(name))
  if (left.length === list.length) continue
  const [section, field] = key.split('.')
  siteConfig[section][field] = left
  configChanges.push(`${key} sans ${list.filter((name) => secrets.includes(name)).join(', ')}`)
}
if (configChanges.length)
  await writeFile(
    'site.config.json',
    await prettier.format(JSON.stringify(siteConfig), {
      ...(await prettier.resolveConfig('site.config.json')),
      filepath: 'site.config.json',
    }),
  )

// The same secrets in the deploy files: the workflows pass them, docker-compose.prod.yml hands them
// to the containers, .env.example documents them (with the comment just above that names it), and
// the smoke test's recorded plan (tests/fixtures/smoke-plan.json) holds the rendered compose file.
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const secretFiles = []
async function dropLines(path, pattern) {
  if (!existsSync(path)) return
  const before = await readFile(path, 'utf8')
  const after = before.replace(pattern, '')
  if (after !== before) {
    await writeFile(path, after)
    secretFiles.push(path)
  }
}
for (const name of secrets) {
  const workflows = existsSync('.github/workflows') ? await readdir('.github/workflows') : []
  for (const file of workflows.filter((entry) => /\.ya?ml$/.test(entry)))
    await dropLines(
      `.github/workflows/${file}`,
      new RegExp(`^[ \\t]*${name}: \\$\\{\\{ secrets\\.${name} \\}\\}[ \\t]*\\n`, 'gm'),
    )
  await dropLines(
    'docker-compose.prod.yml',
    new RegExp(`^[ \\t]*${name}: \\$\\{${name}(?:[:?-][^}]*)?\\}[ \\t]*\\n`, 'gm'),
  )
  await dropLines(
    '.env.example',
    new RegExp(`^(?:# ${name}\\b.*\\n(?:#.*\\n)*)?${name}=.*\\n`, 'gm'),
  )
  const smokePlan = 'tests/fixtures/smoke-plan.json'
  if (existsSync(smokePlan)) {
    let changed = false
    const without = (value) => {
      if (Array.isArray(value)) return value.map(without)
      if (!value || typeof value !== 'object') return value
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => (key === name ? !(changed = true) : true))
          .map(([key, item]) => [key, without(item)]),
      )
    }
    const plan = without(JSON.parse(await readFile(smokePlan, 'utf8')))
    if (changed) {
      await writeFile(
        smokePlan,
        await prettier.format(JSON.stringify(plan, null, 2), {
          ...(await prettier.resolveConfig(smokePlan)),
          filepath: smokePlan,
        }),
      )
      secretFiles.push(smokePlan)
    }
  }
}

// The site's deploy plan (tests/fixtures/release-plan.json) follows deploy.payments and the
// required secrets: re-recorded.
let planRecorded = null
if (
  (configChanges.includes('deploy.payments = false') || secrets.length > 0) &&
  existsSync('tests/test_release_plan.py') &&
  existsSync('deploy/release.py')
) {
  const { spawnSync } = await import('node:child_process')
  const result = spawnSync('python3', ['-m', 'unittest', 'tests.test_release_plan'], {
    encoding: 'utf8',
    env: { ...process.env, UPDATE_RELEASE_PLAN: '1' },
  })
  planRecorded = result.status === 0
  if (planRecorded) {
    const fixture = 'tests/fixtures/release-plan.json'
    await writeFile(
      fixture,
      await prettier.format(await readFile(fixture, 'utf8'), {
        ...(await prettier.resolveConfig(fixture)),
        filepath: fixture,
      }),
    )
  }
}

// The starter record (.starter.json): the removed modules' pieces go (pnpm starter:add brings one back).
if (existsSync('.starter.json')) {
  const record = JSON.parse(await readFile('.starter.json', 'utf8'))
  record.pieces = (record.pieces ?? []).filter((piece) => !names.includes(piece))
  await writeFile('.starter.json', `${JSON.stringify(record, null, 2)}\n`)
}

// Package scripts: deleted files leave their command; a command left without any file goes.
const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
const changedScripts = []
for (const [key, command] of Object.entries(packageJson.scripts ?? {})) {
  const words = command.split(' ')
  const remaining = words.filter((word) => !deleted.has(withoutExtension(word)))
  if (remaining.length === words.length) continue
  changedScripts.push(key)
  if (remaining.some((word) => /\.(ts|tsx|mjs)$/.test(word)))
    packageJson.scripts[key] = remaining.join(' ')
  else delete packageJson.scripts[key]
}
if (changedScripts.length)
  await writeFile('package.json', `${JSON.stringify(packageJson, null, 2)}\n`)

// Mentions left in kept files: quoted or path-like module names, collection and global slugs and
// API paths (prose is left alone).
const slugs = new Set(names)
for (const entry of removed) {
  for (const item of [...(entry.collections ?? []), ...(entry.globals ?? [])]) slugs.add(item.slug)
  try {
    const extra = entry.setup?.({ extensionsFor: () => [] }) ?? {}
    for (const item of [...(extra.collections ?? []), ...(extra.globals ?? [])])
      slugs.add(item.slug)
  } catch {
    // A module whose setup needs its extensions: its own slugs above are enough.
  }
  for (const route of entry.routes ?? [])
    slugs.add(route.replace(/^src\/app\/\([^)]+\)/, '').replace(/\/route\.ts$/, ''))
}
for (const name of secrets) slugs.add(name)
const mention = new RegExp(`(?<=['"\`/}])(?:${[...slugs].map(escape).join('|')})(?=['"\`/?#])`)
const skipped =
  /(^|\/)(node_modules|\.next|\.git|\.test-build|migrations)(\/|$)|payload-types\.ts$|importMap\.js$/
// Tests of the module system itself: their module names are fixtures.
const generic = [
  'tests/architecture.test.ts',
  'tests/modules.test.ts',
  'tests/remove-module.test.ts',
  // The generic secrets script: its secret names are fixtures.
  'tests/github-secrets.test.ts',
]
const mentions = []
for (const root of ['src', 'tests', 'deploy', '.github', 'docs']) {
  if (!existsSync(root)) continue
  for (const entry of await readdir(root, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name)
    if (
      !entry.isFile() ||
      skipped.test(path) ||
      generic.includes(path) ||
      !/\.(ts|tsx|mjs|js|py|json|ya?ml|md)$/.test(path)
    )
      continue
    ;(await readFile(path, 'utf8')).split('\n').forEach((line, index) => {
      if (mention.test(line)) mentions.push(`${path}:${index + 1}: ${line.trim().slice(0, 120)}`)
    })
  }
}
for (const path of (await readdir('.')).filter((file) => /\.(md|json)$/.test(file)))
  if (path !== 'package.json' && !path.endsWith('-lock.json'))
    (await readFile(path, 'utf8')).split('\n').forEach((line, index) => {
      if (mention.test(line)) mentions.push(`${path}:${index + 1}: ${line.trim().slice(0, 120)}`)
    })

const notes = {
  'payments-stripe':
    'GitHub : les secrets STRIPE_* ne servent plus (ne pas les créer, ou les supprimer).',
  // Without --delete-migrations only: the removal migration of a deployed site.
  accounts: deleteMigrations
    ? []
    : [
        'Migration de retrait : y ajouter DROP SCHEMA IF EXISTS "auth" CASCADE (tables Better Auth : utilisateurs, sessions, jetons), que Payload ne génère pas.',
      ],
}
const traefik = {
  accounts:
    'docker-compose.prod.yml : retirer du routeur -auth (limite de débit) Path(`/api/auth/sign-in/magic-link`), Path(`/api/auth/magic-link/verify`) et PathPrefix(`/api/auth/delete-user`).',
}
// A removal migration is still needed for the tables of a module that lists no migration of its
// own (they came with another migration, such as the initial one).
const withMigrations = removed.filter((entry) => entry.migrations?.length)
const removalMigration = !deleteMigrations || withMigrations.length < removed.length
// The job rows of the tasks whose slugs the removal migration takes out of the enums: those of
// every removed module, except one whose migrations go with it (never deployed, nothing queued).
const purged = jobPurgeStatements(
  taskSlugs(removed.filter((entry) => !deleteMigrations || !entry.migrations?.length)),
)
const steps = [
  'pnpm generate:types && pnpm generate:importmap',
  ...(!removalMigration
    ? []
    : [
        `pnpm db:start && pnpm db:migrate:create retrait-${names.join('-')}   (supprime les tables du module ; relire la migration)`,
      ]),
  ...(purged.length
    ? [
        `Migration de retrait : au début de up(), avant le changement des énumérations task_slug, y ajouter ${purged.join(' ')} En production, la prochaine exécution d’une tâche planifiée attend toujours dans payload_jobs : sans ces lignes, la conversion de l’énumération échoue et le déploiement s’arrête.`,
      ]
    : []),
  ...names.flatMap((name) => notes[name] ?? []),
  // Its migrations stay: deleted, a site that ran them would keep their tables with nothing left
  // to remove them. The removal migration drops them, deployed or not.
  ...(migrations.length && !deleteMigrations
    ? [
        `Garder les migrations de ${withMigrations.map((entry) => entry.name).join(', ')} (${migrations.join(', ')}) : la migration de retrait supprime ce qu’elles ont créé, que le site les ait déployées ou non.`,
      ]
    : []),
  ...names.flatMap((name) => traefik[name] ?? []),
  ...(secrets.length
    ? [`GitHub : le secret ${secrets.join(', ')} ne sert plus (ne pas le créer, ou le supprimer).`]
    : []),
  'Adapter les mentions restantes ci-dessous (tests d’intégration, smoke de déploiement, documentation).',
  'pnpm test',
]
console.log(
  [
    `Modules retirés : ${names.join(', ')}.`,
    `Supprimés : ${[...folders, ...files].join(', ')}.`,
    `Registre mis à jour : src/modules/index.ts.`,
    ...(configChanges.length ? [`site.config.json : ${configChanges.join(', ')}.`] : []),
    ...(secretFiles.length
      ? [`Secret ${secrets.join(', ')} retiré de : ${secretFiles.join(', ')}.`]
      : []),
    ...(deleteMigrations && migrations.length
      ? [`Migrations supprimées : ${migrations.join(', ')}.`]
      : []),
    ...(planRecorded === true
      ? ['Plan de déploiement du site réenregistré (tests/fixtures/release-plan.json).']
      : planRecorded === false
        ? [
            'Plan de déploiement à réenregistrer : UPDATE_RELEASE_PLAN=1 python3 -m unittest tests.test_release_plan.',
          ]
        : []),
    ...(existsSync('.starter.json') ? ['.starter.json : briques retirées.'] : []),
    ...(changedScripts.length
      ? [`Scripts package.json modifiés : ${changedScripts.join(', ')}.`]
      : []),
    '',
    'À faire ensuite :',
    ...steps.map((step, index) => `  ${index + 1}. ${step}`),
    '',
    mentions.length
      ? `Mentions restantes (${mentions.length}) :\n${mentions
          .slice(0, 60)
          .map((line) => `  ${line}`)
          .join('\n')}${mentions.length > 60 ? `\n  … et ${mentions.length - 60} autres` : ''}`
      : 'Aucune mention restante.',
  ].join('\n'),
)
