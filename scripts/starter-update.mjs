#!/usr/bin/env node
// Keeps a site up to date with the starter, like a package it embeds. Run in the site:
//
//   node scripts/starter-update.mjs update [--to <ref>]      (pnpm starter:update)
//   node scripts/starter-update.mjs add <piece>              (pnpm starter:add <piece>)
//   node scripts/starter-update.mjs adopt <ref> <piece…> [--repository <owner/name|path>]
//
// The site records the starter version and the pieces it has in .starter.json. `update` merges each
// file of those pieces three ways (the starter at the recorded version, the starter now, the
// site's file) with `git merge-file`; conflicts are left with markers and listed. A new piece never
// arrives by itself: `add` installs it. Never commits. Standard library and the git CLI only (it runs
// in every site, Fontus included, and before `pnpm install`). Design:
// docs/superpowers/specs/2026-11-23-starter-update-design.md in infra-traefik.
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  readdirSync,
  rmdirSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  executables,
  fetchStarter,
  isClean,
  listFiles,
  log,
  resolveRef,
  show,
} from './starter/git.mjs'
import { parseManifest, sharedFiles, withRequired } from './starter/manifest.mjs'

const RECORD = '.starter.json'
const DEFAULT_REPOSITORY = 'NayanChauveau/site-starter'

class Refusal extends Error {}

const readRecord = () => {
  if (!existsSync(RECORD))
    throw new Refusal(
      `${RECORD} absent : ce site n’est pas rattaché au starter (node scripts/starter-update.mjs adopt <version> <briques…>).`,
    )
  const record = JSON.parse(readFileSync(RECORD, 'utf8'))
  return { repository: DEFAULT_REPOSITORY, ignore: [], ...record }
}
const writeRecord = (record) => writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`)

const isBinary = (buffer) => buffer.subarray(0, 8000).includes(0)
const same = (a, b) => a !== null && b !== null && Buffer.compare(a, b) === 0
const readSite = (path) => (existsSync(path) ? readFileSync(path) : null)
const writeSite = (path, content, executable = false) => {
  mkdirSync(dirname(path) || '.', { recursive: true })
  writeFileSync(path, content)
  if (executable) chmodSync(path, 0o755)
}
const MARKER = /^<<<<<<< site$/m
const TOOL = /^scripts\/starter(-update\.mjs|\/)/

/** Deletes a site file, then the folders it leaves empty (never the repository root). */
function removeSite(path) {
  rmSync(path)
  for (let folder = dirname(path); folder !== '.' && folder !== ''; folder = dirname(folder)) {
    if (readdirSync(folder).length) break
    rmdirSync(folder)
  }
}

/** Finishes an update left with conflicts: records its version once no conflict marker remains. */
function finish() {
  const record = readRecord()
  if (!record.pending)
    throw new Refusal('Aucune mise à jour en attente (pending absent de .starter.json).')
  const remaining = (record.conflicts ?? []).filter((path) => {
    const content = readSite(path)
    return content !== null && !isBinary(content) && MARKER.test(content.toString('utf8'))
  })
  if (remaining.length) {
    console.log(
      ['Conflits encore présents :', ...remaining.map((path) => `  - ${path}`)].join('\n'),
    )
    return 1
  }
  const pending = record.pending
  const next = { ...record, version: pending }
  delete next.pending
  delete next.conflicts
  writeRecord(next)
  console.log(
    `Mise à jour terminée : version ${pending.slice(0, 7)} enregistrée dans ${RECORD}. Rien n’est commité.`,
  )
  return 0
}

/** Three-way merge of text with git merge-file: { content, conflict }. */
function merge(ours, base, theirs, labels) {
  const dir = mkdtempSync(join(tmpdir(), 'starter-merge-'))
  try {
    const files = ['ours', 'base', 'theirs'].map((name) => join(dir, name))
    writeFileSync(files[0], ours)
    writeFileSync(files[1], base)
    writeFileSync(files[2], theirs)
    const result = spawnSync(
      'git',
      ['merge-file', '-p', '--diff3', ...labels.flatMap((label) => ['-L', label]), ...files],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    if (result.status === null || result.status < 0 || result.status > 127)
      throw new Error(`git merge-file : ${String(result.stderr)}`)
    return { content: result.stdout, conflict: result.status > 0 }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** The manifest at `rev`, or null when that version has none (before starter.json existed). */
function manifestAt(dir, rev) {
  const json = show(dir, rev, 'starter.json')
  return json ? parseManifest(json.toString('utf8')) : null
}

function dependencyVersions(json) {
  if (!json) return {}
  const parsed = JSON.parse(json.toString('utf8'))
  return { ...parsed.dependencies, ...parsed.devDependencies }
}

function update(options) {
  const record = readRecord()
  if (record.pending)
    throw new Refusal(
      `Une mise à jour vers ${record.pending.slice(0, 7)} attend la résolution de ses conflits : les résoudre, puis node scripts/starter-update.mjs update --continue.`,
    )
  if (!isClean('.', [RECORD]))
    throw new Refusal('Modifications non commitées : la mise à jour doit pouvoir être relue seule.')
  const starter = fetchStarter(record.repository)
  try {
    const base = resolveRef(starter.dir, record.version)
    const target = resolveRef(starter.dir, options.to ?? 'HEAD')
    const manifest = manifestAt(starter.dir, target)
    if (!manifest) throw new Refusal(`Le starter n’a pas de starter.json à ${target.slice(0, 7)}.`)
    for (const piece of record.pieces)
      if (!(piece in manifest.pieces)) throw new Refusal(`Brique inconnue du starter : ${piece}.`)
    const baseManifest = manifestAt(starter.dir, base)
    const targetFiles = listFiles(starter.dir, target)
    const baseOnly = listFiles(starter.dir, base).filter((path) => !targetFiles.includes(path))
    const paths = [
      ...sharedFiles(manifest, targetFiles, record.pieces, record.ignore),
      ...sharedFiles(baseManifest ?? manifest, baseOnly, record.pieces, record.ignore),
    ]
    const labels = ['site', `starter ${base.slice(0, 7)}`, `starter ${target.slice(0, 7)}`]
    const executable = executables(starter.dir, target)
    const report = {
      updated: [],
      added: [],
      deleted: [],
      conflicts: [],
      binary: [],
      keptDeleted: [],
    }
    for (const path of paths) {
      const before = show(starter.dir, base, path)
      const after = show(starter.dir, target, path)
      const ours = readSite(path)
      if (after === null) {
        if (ours === null) continue
        if (same(ours, before)) {
          removeSite(path)
          report.deleted.push(path)
        } else report.keptDeleted.push(path)
      } else if (ours === null) {
        writeSite(path, after, executable.has(path))
        report.added.push(path)
      } else if (same(before, after) || same(ours, after)) {
        continue
      } else if (same(ours, before)) {
        writeSite(path, after, executable.has(path))
        report.updated.push(path)
      } else if (isBinary(ours) || isBinary(after) || (before && isBinary(before))) {
        report.conflicts.push(path)
        report.binary.push(path)
      } else {
        const merged = merge(ours, before ?? Buffer.alloc(0), after, labels)
        writeSite(path, merged.content, executable.has(path))
        if (merged.conflict) report.conflicts.push(path)
        else report.updated.push(path)
      }
    }
    const touched = [...report.updated, ...report.added, ...report.conflicts]
    // Payload collections and globals live in the application code (src/), typed with these names.
    const schema = touched.filter(
      (path) =>
        /^src\/.*\.tsx?$/.test(path) &&
        /CollectionConfig|GlobalConfig/.test(
          show(starter.dir, target, path)?.toString('utf8') ?? '',
        ),
    )
    const starterVersions = dependencyVersions(show(starter.dir, target, 'package.json'))
    const siteVersions = dependencyVersions(readSite('package.json'))
    const dependencies = record.pieces
      .flatMap((piece) => manifest.pieces[piece].dependencies ?? [])
      .filter((name) => starterVersions[name] && starterVersions[name] !== siteVersions[name])
      .map(
        (name) =>
          `${name} : ${siteVersions[name] ?? 'absent'} ici, ${starterVersions[name]} dans le starter`,
      )
    // Files of the site's pieces at `base` that the starter moved to a piece the site lacks: left
    // as they are (the site may still use them), and reported.
    const movedAway = baseManifest
      ? sharedFiles(
          baseManifest,
          listFiles(starter.dir, base),
          record.pieces,
          record.ignore,
        ).filter(
          (path) =>
            existsSync(path) &&
            targetFiles.includes(path) &&
            !paths.includes(path) &&
            sharedFiles(manifest, [path], Object.keys(manifest.pieces), []).length > 0,
        )
      : []
    const available = Object.keys(manifest.pieces)
      .filter((piece) => !record.pieces.includes(piece))
      .map((piece) =>
        baseManifest && !(piece in baseManifest.pieces) ? `${piece} (nouveau)` : piece,
      )

    const section = (title, items) =>
      items.length ? [`${title} :`, ...items.map((item) => `  - ${item}`)] : []
    const summary = [
      `Starter ${base.slice(0, 7)} → ${target.slice(0, 7)} (briques : ${record.pieces.join(', ')})`,
      ...section('Mis à jour', report.updated),
      ...section('Ajoutés', report.added),
      ...section('Supprimés', report.deleted),
      ...section('Supprimés dans le starter, modifiés ici (gardés)', report.keptDeleted),
      ...section('Passés dans une brique absente du site (laissés tels quels)', movedAway),
      ...(report.conflicts.some((path) => TOOL.test(path))
        ? [
            'Attention : l’outil de mise à jour lui-même est en conflit ; résoudre d’abord ses fichiers (scripts/starter-update.mjs, scripts/starter/), sinon --continue ne peut pas tourner.',
          ]
        : []),
      ...section(
        'Conflits à résoudre',
        report.conflicts.map((path) =>
          report.binary.includes(path)
            ? `${path} (binaire modifié des deux côtés : version du site gardée)`
            : path,
        ),
      ),
      ...section('Ignorés (ignore)', record.ignore),
      ...section('Dépendances npm différentes', dependencies),
      ...section('Briques disponibles, non installées (pnpm starter:add <brique>)', available),
      ...(schema.length
        ? [
            'Le schéma a peut-être changé : lancer pnpm payload migrate:create et relire la migration,',
            'puis régénérer les types et la carte des imports (pnpm generate:types, pnpm generate:importmap).',
            ...schema.map((path) => `  - ${path}`),
          ]
        : []),
    ]
    if (
      !report.updated.length &&
      !report.added.length &&
      !report.deleted.length &&
      !report.conflicts.length
    )
      summary.push('Rien à changer : le site est à jour pour ses briques.')
    summary.push(
      report.conflicts.length
        ? `Version non enregistrée (${RECORD}, « pending ») tant que les conflits restent : les résoudre, puis node scripts/starter-update.mjs update --continue.`
        : `Version enregistrée dans ${RECORD}. Rien n’est commité.`,
    )
    const reports = process.env['STARTER_UPDATE_REPORT_DIR'] ?? tmpdir()
    const file = join(reports, `starter-update-${basename(process.cwd())}-${target.slice(0, 7)}.md`)
    const commits = log(starter.dir, base, target)
    writeFileSync(
      file,
      [
        `Mise à jour depuis le starter (${base.slice(0, 7)} → ${target.slice(0, 7)})`,
        '',
        ...summary,
        '',
        'Changements du starter :',
        ...(commits.length ? commits.map((line) => `- ${line}`) : ['- aucun']),
        '',
      ].join('\n'),
    )
    // Recorded once the report is written: a failure before leaves the record as it was.
    writeRecord(
      report.conflicts.length
        ? { ...record, pending: target, conflicts: report.conflicts }
        : { ...record, version: target },
    )
    console.log([...summary, `Description de pull request : ${file}`].join('\n'))
    return report.conflicts.length ? 1 : 0
  } finally {
    starter.cleanup()
  }
}

const camel = (id) => id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())

const MIGRATION_INDEX = 'src/migrations/index.ts'

/**
 * Adds one migration to src/migrations/index.ts (Payload's layout), last; false when the index is
 * missing or unreadable as such. Already listed: left as it is.
 */
function registerMigration(name) {
  const source = readSite(MIGRATION_INDEX)?.toString('utf8')
  if (!source) return false
  if (source.includes(`name: '${name}'`)) return true
  const imports = [...source.matchAll(/^import .*\n/gm)]
  const last = imports.at(-1)
  const end = source.lastIndexOf('\n]')
  if (!last || end < 0) return false
  const at = last.index + last[0].length
  const withImport = `${source.slice(0, at)}import * as migration_${name} from './${name}'\n${source.slice(at)}`
  const close = withImport.lastIndexOf('\n]')
  writeSite(
    MIGRATION_INDEX,
    `${withImport.slice(0, close)}\n  {\n    up: migration_${name}.up,\n    down: migration_${name}.down,\n    name: '${name}',\n  },${withImport.slice(close)}`,
  )
  return true
}

function add(name) {
  const record = readRecord()
  if (!isClean('.', [RECORD]))
    throw new Refusal('Modifications non commitées : l’ajout doit pouvoir être relu seul.')
  const starter = fetchStarter(record.repository)
  try {
    const target = resolveRef(starter.dir, 'HEAD')
    if (resolveRef(starter.dir, record.version) !== target)
      throw new Refusal(
        `Le site n’est pas à la dernière version du starter : lancer d’abord pnpm starter:update, puis ajouter ${name}.`,
      )
    const manifest = manifestAt(starter.dir, target)
    if (!manifest) throw new Refusal(`Le starter n’a pas de starter.json à ${target.slice(0, 7)}.`)
    const pieces = withRequired(manifest, [name]).filter((piece) => !record.pieces.includes(piece))
    if (!pieces.length) {
      console.log(`${name} est déjà installée.`)
      return 0
    }
    const written = []
    const conflicts = []
    for (const path of sharedFiles(
      manifest,
      listFiles(starter.dir, target),
      pieces,
      record.ignore,
    )) {
      const theirs = show(starter.dir, target, path)
      const ours = readSite(path)
      if (ours === null) {
        writeSite(path, theirs)
        written.push(path)
      } else if (!same(ours, theirs)) {
        if (!isBinary(ours) && !isBinary(theirs))
          writeSite(
            path,
            merge(ours, Buffer.alloc(0), theirs, ['site', 'vide', `starter ${target.slice(0, 7)}`])
              .content,
          )
        conflicts.push(path)
      }
    }
    // The module's migrations (src/migrations is per site): a hand-written one (no Payload snapshot,
    // such as the accounts `auth` schema) cannot be regenerated, so it is copied and registered; a
    // generated one holds the starter's schema, so `pnpm payload migrate:create` redoes it here.
    const copiedMigrations = []
    const generatedMigrations = []
    for (const piece of pieces)
      for (const name of manifest.pieces[piece].migrations ?? []) {
        const path = `src/migrations/${name}.ts`
        const source = show(starter.dir, target, path)
        if (!source) continue
        if (show(starter.dir, target, `src/migrations/${name}.json`)) {
          generatedMigrations.push(name)
          continue
        }
        if (readSite(path) === null) writeSite(path, source)
        if (registerMigration(name)) copiedMigrations.push(name)
      }
    writeRecord({ ...record, pieces: withRequired(manifest, [...record.pieces, ...pieces]) })
    const versions = dependencyVersions(show(starter.dir, target, 'package.json'))
    const starterConfig = JSON.parse(
      show(starter.dir, target, 'site.config.json')?.toString('utf8') ?? '{}',
    )
    const steps = pieces.flatMap((piece) => {
      const entry = manifest.pieces[piece]
      const lines = []
      if (entry.module) {
        const symbol = `${camel(entry.module)}Module`
        lines.push(
          `src/modules/index.ts : ajouter import { ${symbol} } from './${entry.module}/module' et ${symbol} dans la liste.`,
        )
        const config = starterConfig.modules?.[entry.module]
        if (config)
          lines.push(
            `site.config.json : modules.${entry.module} (valeurs du starter : ${JSON.stringify(config)}).`,
          )
      }
      for (const dependency of entry.dependencies ?? [])
        lines.push(
          `pnpm add ${dependency}${versions[dependency] ? `@${versions[dependency]}` : ''}`,
        )
      // The deploy secrets only this module reads: pnpm module:remove took them out of these files.
      for (const secret of entry.secrets ?? [])
        lines.push(
          `secret ${secret} : l’ajouter à deploy.requiredSecrets et github.secrets de site.config.json, à l’env du job deploy de .github/workflows/deploy.yml (${secret}: \${{ secrets.${secret} }}) et à l’environnement de docker-compose.prod.yml (${secret}: \${${secret}:-}), puis le créer dans GitHub (bash scripts/github-secrets.sh le génère).`,
        )
      return lines
    })
    console.log(
      [
        `Briques ajoutées : ${pieces.join(', ')} (starter ${target.slice(0, 7)}).`,
        ...(written.length ? ['Fichiers écrits :', ...written.map((path) => `  - ${path}`)] : []),
        ...(conflicts.length
          ? ['Conflits à résoudre :', ...conflicts.map((path) => `  - ${path}`)]
          : []),
        'Reste à faire à la main :',
        ...steps.map((step) => `  - ${step}`),
        ...(copiedMigrations.length
          ? [
              `  - migrations écrites à la main copiées et inscrites dans src/migrations/index.ts : ${copiedMigrations.join(', ')} ;`,
            ]
          : []),
        `  - pnpm payload migrate:create, puis relire la migration${generatedMigrations.length ? ` (elle refait pour ce site ${generatedMigrations.join(', ')} du starter)` : ''} ;`,
        '  - régénérer les types et la carte des imports (pnpm generate:types, pnpm generate:importmap).',
        `Brique(s) enregistrée(s) dans ${RECORD}. Rien n’est commité.`,
      ].join('\n'),
    )
    return conflicts.length ? 1 : 0
  } finally {
    starter.cleanup()
  }
}

function adopt(ref, names, repository = DEFAULT_REPOSITORY) {
  if (existsSync(RECORD))
    throw new Refusal(`${RECORD} existe déjà : ce site est déjà rattaché au starter.`)
  if (!names.length) throw new Refusal('Indiquer les briques du site (par exemple : deploy).')
  const starter = fetchStarter(repository)
  try {
    const version = resolveRef(starter.dir, ref)
    const manifest = manifestAt(starter.dir, 'HEAD')
    if (!manifest) throw new Refusal('Le starter n’a pas de starter.json.')
    const pieces = withRequired(manifest, names)
    writeRecord({ repository, version, pieces, ignore: [] })
    console.log(
      `${RECORD} écrit : starter ${version.slice(0, 7)}, briques ${pieces.join(', ')}. Aucun autre fichier modifié.`,
    )
    return 0
  } finally {
    starter.cleanup()
  }
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      to: { type: 'string' },
      repository: { type: 'string' },
      continue: { type: 'boolean' },
    },
  })
  const [command = 'update', ...rest] = positionals
  if (command === 'update' && rest.length === 0) return values.continue ? finish() : update(values)
  if (command === 'add' && rest.length === 1) return add(rest[0])
  if (command === 'adopt' && rest.length >= 1)
    return adopt(rest[0], rest.slice(1), values.repository)
  throw new Refusal(
    'Usage : node scripts/starter-update.mjs update [--to <version>] | add <brique> | adopt <version> <briques…>',
  )
}

try {
  process.exitCode = main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = error instanceof Refusal ? 2 : 3
}
