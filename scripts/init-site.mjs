// Turns the starter into a new site: fills site.config.json from a few values, after checking that
// none is already used by a site of the VPS (infra-traefik's sites.json, the other site
// repositories next to this one, the known ports), and the developer files bound to it
// (tests/site-config.test.ts: package name, local database, local URL). Writes nothing else and
// never a secret: it prints the GitHub secrets and variables to create, the deploy key to generate
// and the sites.json entry.
//
//   node scripts/init-site.mjs --slug <slug> --name "<nom affiché>" --domain <domaine> \
//     --port <port> --locales fr,en [--modules orders,payments-stripe] [--reference-prefix <AB>] \
//     [--registry ../infra-traefik/sites.json] [--sites ..] [--starter <owner/name|path>] [--starter-version <ref>]
//
// A new site starts without any module (only the deploy kit and the socle): --modules keeps the ones
// named (and those they require), the others are removed with scripts/remove-module.mjs; more are
// added later with pnpm starter:add <piece>. It records the starter version the repository was made
// from and its pieces in .starter.json (pnpm starter:update): the version is the starter commit whose
// tree equals this repository's first commit (a GitHub template copy), or --starter-version.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { repositoryFiles } from './repository-files.mjs'
import { isAllowed, siteValueOffenders } from './site-values.mjs'
import { commitsWithTrees, fetchStarter, resolveRef } from './starter/git.mjs'
import { parseManifest, withRequired } from './starter/manifest.mjs'

const fail = (message) => {
  console.error(message)
  process.exit(1)
}
let options
try {
  ;({ values: options } = parseArgs({
    options: {
      slug: { type: 'string' },
      name: { type: 'string' },
      domain: { type: 'string' },
      port: { type: 'string' },
      'reference-prefix': { type: 'string' },
      locales: { type: 'string' },
      registry: { type: 'string', default: '../infra-traefik/sites.json' },
      sites: { type: 'string', default: '..' },
      modules: { type: 'string', default: '' },
      starter: { type: 'string', default: 'NayanChauveau/site-starter' },
      'starter-version': { type: 'string' },
    },
  }))
} catch (error) {
  fail(error.message)
}
const usage =
  'Usage : node scripts/init-site.mjs --slug <slug> --name <nom affiché> --domain <domaine> ' +
  '--port <port> --locales fr,en [--modules <modules>] [--reference-prefix <AB>] [--registry <sites.json>] ' +
  '[--sites <dossier>] [--starter <dépôt>] [--starter-version <version>]'
for (const key of ['slug', 'name', 'domain', 'port', 'locales'])
  if (!options[key]?.trim()) fail(`--${key} manquant.\n${usage}`)
if (existsSync('.starter.json'))
  fail(
    'Ce dépôt est déjà initialisé (.starter.json existe) : init-site ne s’applique qu’au starter.',
  )

// ---- the modules kept (starter.json pieces that are modules) ----------------------------------
const manifest = parseManifest(readFileSync('starter.json', 'utf8'))
// The module pieces whose code is in this repository (a copy may already lack some).
const moduleOf = Object.fromEntries(
  Object.entries(manifest.pieces).flatMap(([piece, entry]) =>
    entry.module && existsSync(`src/modules/${entry.module}`) ? [[piece, entry.module]] : [],
  ),
)
const requested = options.modules
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
for (const item of requested)
  if (!(item in moduleOf))
    fail(`Module inconnu : ${item}. Modules du starter : ${Object.keys(moduleOf).join(', ')}.`)
const pieces = withRequired(manifest, ['core', ...requested])
const kept = pieces.filter((piece) => piece in moduleOf)
const removed = Object.keys(moduleOf).filter((piece) => !kept.includes(piece))
const keepsOrders = kept.includes('orders')
if (keepsOrders && !options['reference-prefix']?.trim())
  fail(`--reference-prefix manquant (le module orders est gardé).\n${usage}`)

// Ports taken on this machine and on the VPS even when the other repositories are not checked out;
// the starter's own placeholder port (read from site.config.json) is refused too.
const knownPorts = { 3100: 'un site du VPS', 3200: 'un site du VPS' }
const supportedLocales = ['fr', 'en'] // src/core/i18n/locales.ts

// ---- the values ------------------------------------------------------------------------------
const slug = options.slug.trim()
const name = options.name.trim()
const domain = options.domain.trim().toLowerCase()
const port = Number(options.port)
const prefix = keepsOrders ? options['reference-prefix'].trim() : null
const locales = options.locales.split(',').map((locale) => locale.trim())
const errors = []
// sites.json `name` (scripts/sites.py NAME_RE) and the site slug (src/core/site.ts) at once.
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 40)
  errors.push(`slug ${slug} invalide (minuscules, chiffres et tirets, 40 caractères au plus)`)
if (slug === 'example') errors.push('slug example : c’est la valeur d’exemple du starter')
if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain))
  errors.push(`domaine ${domain} invalide (nom de domaine complet attendu, sans https://)`)
if (/\.(invalid|test|example|localhost)$/.test(domain))
  errors.push(`domaine ${domain} réservé, pas un vrai domaine`)
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  errors.push(`port ${options.port} invalide (1024 à 65535)`)
if (prefix !== null && !/^[A-Z]{2,6}$/.test(prefix))
  errors.push(`préfixe de référence ${prefix} invalide (2 à 6 lettres majuscules)`)
// The site layer and src/core/i18n/locales.ts serve every supported language: --locales chooses
// the default one (first); dropping a language is a code change first, not a configuration value.
if (
  locales.length !== supportedLocales.length ||
  supportedLocales.some((locale) => !locales.includes(locale))
)
  errors.push(
    `langues ${options.locales} invalides : toutes celles du code (${supportedLocales.join(', ')}), ` +
      'la première par défaut. Retirer une langue demande d’abord de modifier src/core/i18n/locales.ts.',
  )
if (errors.length) fail(`Valeurs refusées :\n${errors.map((line) => `  - ${line}`).join('\n')}`)

const configPath = 'site.config.json'
const config = JSON.parse(readFileSync(configPath, 'utf8'))
if (config.slug !== 'example')
  fail(
    `Ce dépôt est déjà initialisé (slug ${config.slug}) : init-site ne s’applique qu’au starter. ` +
      'Modifier site.config.json à la main.',
  )

// ---- what is already used --------------------------------------------------------------------
const registryPath = resolve(options.registry)
if (!existsSync(registryPath))
  fail(
    `Registre introuvable : ${registryPath}. Indiquer le sites.json d’infra-traefik avec --registry.`,
  )
let registry
try {
  registry = JSON.parse(readFileSync(registryPath, 'utf8')).sites
  if (!Array.isArray(registry)) throw new Error('clé sites absente')
} catch (error) {
  fail(`Registre illisible (${registryPath}) : ${error.message}`)
}
const hostOf = (url) => {
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/** Every value another site uses, with who uses it: [kind, value, owner]. */
const used = []
const take = (kind, value, owner) => {
  if (value !== undefined && value !== null && value !== '') used.push([kind, value, owner])
}
for (const entry of registry) {
  const owner = `${entry.name} (sites.json)`
  take('slug', entry.name, owner)
  take('projet compose', entry.project, owner)
  take('volume', entry.mediaVolume, owner)
  const host = hostOf(entry.health)
  take('domaine', host, owner)
  if (host) take('domaine', host.startsWith('www.') ? host.slice(4) : `www.${host}`, owner)
}
for (const [value, owner] of Object.entries(knownPorts)) take('port', Number(value), owner)
take('port', config.app.port, 'le starter (valeur d’exemple)')

const here = resolve('.')
const sitesFolder = resolve(options.sites)
for (const folder of existsSync(sitesFolder) ? readdirSync(sitesFolder) : []) {
  const path = join(sitesFolder, folder, 'site.config.json')
  if (resolve(sitesFolder, folder) === here || !existsSync(path)) continue
  let other
  try {
    other = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    fail(`Configuration illisible : ${path}`)
  }
  const owner = `${other.slug ?? folder} (${basename(folder)}/site.config.json)`
  take('slug', other.slug, owner)
  take('port', other.app?.port, owner)
  take('domaine', other.identity?.domain, owner)
  take('domaine', other.deploy?.defaultHost, owner)
  take('projet compose', other.deploy?.composeProject, owner)
  take('dossier', other.deploy?.directory, owner)
  take('nom Traefik', other.deploy?.traefikName, owner)
  take('préfixe de référence', other.modules?.orders?.referencePrefix, owner)
}

// ---- the new configuration -------------------------------------------------------------------
const owner = /^ghcr\.io\/([^/]+)\//.exec(config.deploy.imageRepository)?.[1] ?? 'nayanchauveau'
const project = `${slug}-prod`
const identifier = slug.replace(/-/g, '_')
const wanted = [
  ['slug', slug],
  ['port', port],
  ['domaine', domain],
  ['domaine', `www.${domain}`],
  ['projet compose', project],
  ['volume', `${project}-media`],
  ['dossier', `/srv/${slug}`],
  ['nom Traefik', slug],
  ...(prefix ? [['préfixe de référence', prefix]] : []),
]
const conflicts = wanted.flatMap(([kind, value]) =>
  used
    .filter(([usedKind, usedValue]) => usedKind === kind && usedValue === value)
    .map(([, , by]) => `${kind} ${value} déjà utilisé par ${by}`),
)
if (conflicts.length)
  fail(
    `Valeurs déjà utilisées, rien n’est écrit :\n${[...new Set(conflicts)].map((line) => `  - ${line}`).join('\n')}`,
  )

const otherHosts = used
  .filter(([kind]) => kind === 'domaine')
  .map(([, value]) => value)
  .filter((host) => !host.endsWith('.invalid'))
const protectedHosts = [...new Set([...config.deploy.protectedHosts, ...otherHosts])].filter(
  (host) => host !== domain && host !== `www.${domain}`,
)
const next = {
  ...config,
  slug,
  identity: {
    ...config.identity,
    displayName: name,
    domain,
    locales: supportedLocales,
    defaultLocale: locales[0],
  },
  app: { ...config.app, port, logService: slug, userAgent: `${slug}/0.1` },
  modules: {
    ...config.modules,
    ...(prefix && config.modules.orders
      ? {
          orders: {
            ...config.modules.orders,
            referencePrefix: prefix,
            accessCookiePrefix: `${prefix.toLowerCase()}_order_`,
          },
        }
      : {}),
  },
  deploy: {
    ...config.deploy,
    directory: `/srv/${slug}`,
    composeProject: project,
    imageRepository: `ghcr.io/${owner}/${slug}`,
    volumeOwnerLabel: `${slug}.owner`,
    volumes: { database: `${project}-pgdata`, media: `${project}-media`, legacyDatabase: null },
    database: { name: identifier, user: identifier },
    traefikName: slug,
    defaultHost: domain,
    protectedHosts,
  },
}
// The generic code must not already contain a new value as a word: tests/site-values.test.ts
// would flag it once the site is initialised. Same files and same matching as that test.
const generic = repositoryFiles()
  .filter((path) => !isAllowed(path))
  .flatMap((path) => {
    const bytes = readFileSync(path)
    return bytes.includes(0) ? [] : [[path, bytes.toString('utf8')]]
  })
const written = new Map()
for (const { path, line, value } of siteValueOffenders(next, generic))
  written.set(value, [...(written.get(value) ?? []), `${path}:${line}`])
if (written.size)
  fail(
    `Valeurs déjà écrites comme mot dans le code générique du starter, rien n’est écrit :\n${[
      ...written,
    ]
      .map(
        ([value, places]) =>
          `  - ${value} : ${places.slice(0, 5).join(', ')}${places.length > 5 ? `, … (${places.length})` : ''}`,
      )
      .join('\n')}\n` +
      'Le test site-values (pnpm test --group=static) les refuserait : choisir une autre valeur ' +
      '(par exemple un slug ou un nom plus distinctif).',
  )

// ---- the starter version this repository was made from (before anything is written) ----------
let starterVersion
{
  let starter
  let problem = null
  try {
    starter = fetchStarter(options.starter)
    if (options['starter-version'])
      starterVersion = resolveRef(starter.dir, options['starter-version'])
    else {
      let tree = null
      try {
        const root = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
          .trim()
          .split('\n')
          .at(-1)
        tree = execFileSync('git', ['rev-parse', `${root}^{tree}`], { encoding: 'utf8' }).trim()
      } catch {
        tree = null
      }
      starterVersion = commitsWithTrees(starter.dir, 'HEAD', 500).find(
        (entry) => entry.tree === tree,
      )?.commit
    }
  } catch (error) {
    // fail() exits: the temporary clone is removed first, below.
    problem = starter
      ? `${error.message}, rien n’est écrit.`
      : `Starter injoignable, rien n’est écrit : ${error.message}`
  } finally {
    starter?.cleanup()
  }
  if (problem) fail(problem)
  if (!starterVersion)
    fail(
      'Version du starter introuvable (le premier commit de ce dépôt ne correspond à aucune version récente ' +
        'du starter), rien n’est écrit. Relancer avec --starter-version <version du starter copiée>.',
    )
}

// The configuration is written as `pnpm format` would (the static group runs prettier --check).
const prettier = await import('prettier')
const prettierOptions = await prettier.resolveConfig(configPath)
// Developer files: every replacement must apply, or nothing is written.
const placeholder = /(?<![A-Za-z0-9])example(?![A-Za-z0-9])/g
const rewrite = (path, source, replacements) => {
  let result = source
  for (const [pattern, value] of replacements) {
    if (!pattern.test(result)) fail(`${path} : ${pattern} introuvable, rien n’est écrit.`)
    pattern.lastIndex = 0
    result = result.replace(pattern, value)
  }
  return result
}
const files = {
  [configPath]: await prettier.format(JSON.stringify(next), {
    ...prettierOptions,
    filepath: configPath,
  }),
  'package.json': rewrite('package.json', readFileSync('package.json', 'utf8'), [
    [/^(\s*"name": )"example",$/m, `$1"${slug}",`],
  ]),
  'docker-compose.yml': rewrite('docker-compose.yml', readFileSync('docker-compose.yml', 'utf8'), [
    [/^name: example$/m, `name: ${slug}`],
    [placeholder, identifier],
  ]),
  '.env.example': rewrite('.env.example', readFileSync('.env.example', 'utf8'), [
    [
      new RegExp(`^APP_URL=http://localhost:${config.app.port}$`, 'm'),
      `APP_URL=http://localhost:${port}`,
    ],
    [/^DATABASE_URL=.*$/m, (line) => line.replace(placeholder, identifier)],
  ]),
}
// Kept to put everything back if the module removal below is refused: nothing half-written.
const originals = Object.fromEntries(Object.keys(files).map((path) => [path, readFileSync(path)]))
for (const [path, content] of Object.entries(files)) writeFileSync(path, content)

// ---- the modules not kept, then the starter record -------------------------------------------
let removal = ''
if (removed.length) {
  const result = spawnSync(
    process.execPath,
    // A new site never deployed these modules: their migrations go too (no removal migration).
    [
      '--import',
      'tsx',
      'scripts/remove-module.mjs',
      '--delete-migrations',
      ...removed.map((piece) => moduleOf[piece]),
    ],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    for (const [path, content] of Object.entries(originals)) writeFileSync(path, content)
    fail(
      `Retrait des modules (${removed.join(', ')}) en échec, rien n’est écrit :\n${result.stdout}${result.stderr}`,
    )
  }
  removal = result.stdout
}
writeFileSync(
  '.starter.json',
  `${JSON.stringify({ repository: options.starter, version: starterVersion, pieces, ignore: [] }, null, 2)}\n`,
)

// ---- what is left to do (printed, never written) ---------------------------------------------
// As the removal left it: the removed modules' secrets (manifest `secrets`) are no longer listed.
const afterRemoval = JSON.parse(readFileSync(configPath, 'utf8'))
const secretHints = {
  ADMIN_RESET_PASSWORD: 'mot de passe temporaire du workflow admin-reset (à créer au besoin)',
  BETTER_AUTH_SECRET:
    'openssl rand -hex 32 (secret des comptes visiteurs, à garder dans le gestionnaire de mots de passe)',
  BOOTSTRAP_ADMIN_EMAIL: 'email du premier administrateur',
  BOOTSTRAP_ADMIN_NAME: 'nom du premier administrateur',
  BOOTSTRAP_ADMIN_PASSWORD:
    'mot de passe du premier administrateur (gestionnaire de mots de passe)',
  GOOGLE_MAPS_API_KEY:
    'clé Google Places API (New), facultative (recherche d’adresse) ; sans elle, saisie à la main',
  PAYLOAD_SECRET: 'openssl rand -hex 32 (à garder dans le gestionnaire de mots de passe)',
  POSTGRES_PASSWORD: 'openssl rand -hex 32 (à garder dans le gestionnaire de mots de passe)',
  SMTP_URL: 'URL SMTP du fournisseur d’email (smtps://utilisateur:mot-de-passe@hôte:465)',
  SSH_HOST: 'adresse du VPS, comme pour les autres sites',
  SSH_PORT: 'port SSH du VPS, comme pour les autres sites',
  SSH_USER: 'utilisateur SSH des déploiements, comme pour les autres sites',
  SSH_KNOWN_HOSTS: 'ligne known_hosts déjà vérifiée du VPS, la même que pour les autres sites',
  SSH_KEY: 'clé privée de déploiement générée ci-dessous (contenu du fichier sans .pub)',
  SSH_PASSPHRASE: 'phrase de passe de cette clé, si elle en a une ; sinon ne pas créer',
  SSH_PASSWORD: 'inutile avec SSH_KEY, ne pas créer',
  STRIPE_TEST_SECRET_KEY: 'clé secrète Stripe du mode test (sk_test_…)',
  STRIPE_TEST_WEBHOOK_SECRET: `secret du webhook Stripe de test vers https://${domain}/api/commerce/webhook`,
  STRIPE_LIVE_SECRET_KEY: 'clé Stripe live : seulement à l’ouverture',
  STRIPE_LIVE_WEBHOOK_SECRET: 'secret du webhook Stripe live : seulement à l’ouverture',
}
const variableHints = {
  EMAIL_FROM: `expéditeur des emails, par exemple "${name} <contact@${domain}>"`,
  EMAIL_MODE: 'simulated tant que l’envoi réel n’est pas vérifié (email-test), puis smtp',
  EMAIL_REPLY_TO: 'adresse de réponse (facultatif)',
  PRODUCTION_ALIASES: `autres hôtes servis (par exemple www.${domain}), vide sinon`,
  PRODUCTION_DEPLOY_ENABLED: 'false jusqu’au premier déploiement voulu, puis true',
  PRODUCTION_HOST: domain,
  PUBLIC_INDEXING: 'false jusqu’à l’ouverture au public',
  STRIPE_MODE: 'test',
  VPS_IPV4: 'adresse IPv4 du VPS (contrôle du DNS par cutover-check)',
}
const key = `~/.ssh/github-actions-${slug}`
const entry = {
  name: slug,
  project,
  database: identifier,
  user: identifier,
  mediaVolume: `${project}-media`,
  containers: ['web', 'postgres'],
  health: `https://${domain}/api/health`,
  deployKeyFingerprint: 'SHA256:<empreinte de l’étape 3>',
  requiredTables: ['users', 'media'],
}
const list = (names, hints) =>
  names.map((item) => `     - ${item}${hints[item] ? ` : ${hints[item]}` : ''}`).join('\n')
console.log(`site.config.json initialisé pour ${name} (${slug}) :
  domaine ${domain}, port ${port}, langues ${locales.join(', ')}${prefix ? `, références ${prefix}-…` : ''}
  modules : ${kept.length ? kept.join(', ') : 'aucun'}${removed.length ? ` (retirés : ${removed.join(', ')})` : ''} ; en ajouter un : pnpm starter:add <module>
  starter ${starterVersion.slice(0, 7)} et briques ${pieces.join(', ')} enregistrés dans .starter.json (pnpm starter:update)
  /srv/${slug}, projet ${project}, image ghcr.io/${owner}/${slug}, base ${identifier}
Fichiers de développement alignés : package.json, docker-compose.yml, .env.example (recopier dans .env).
${removed.length ? 'Modules non gardés retirés (scripts/remove-module.mjs, migration et types à régénérer : voir plus bas).' : 'Aucun autre fichier n’a été modifié.'} Aucun secret n’a été écrit.

À faire ensuite (détail dans STARTER.md) :

1. Vérifier : pnpm test --group=static

2. Secrets GitHub du dépôt (Settings > Secrets and variables > Actions), tapés par le propriétaire :
${list(
  afterRemoval.github.secrets.filter(
    (item) => kept.includes('payments-stripe') || !item.startsWith('STRIPE_'),
  ),
  secretHints,
)}

3. Clé de déploiement, sur le poste du propriétaire :
     ssh-keygen -t ed25519 -C github-actions-${slug} -f ${key}
   Ligne à ajouter dans /root/.ssh/authorized_keys du VPS (copie de sauvegarde du fichier d’abord) :
     restrict ssh-ed25519 <contenu de ${key}.pub sans le commentaire> github-actions-${slug}
   Empreinte, pour l’alerte SSH d’infra-traefik (deployKeyFingerprint ci-dessous) :
     ssh-keygen -lf ${key}.pub

4. Variables GitHub du dépôt :
${list(
  config.github.variables.filter(
    (item) => kept.includes('payments-stripe') || !item.startsWith('STRIPE_'),
  ),
  variableHints,
)}

5. Entrée à ajouter dans sites.json d’infra-traefik (${registryPath}) :
${JSON.stringify(entry, null, 2)
  .split('\n')
  .map((line) => `     ${line}`)
  .join('\n')}
   puis, dans infra-traefik : python3 scripts/sites.py generate, et ses tests (README, « Ajouter un site »).
${removal ? `\nRetrait des modules :\n${removal}` : ''}`)
