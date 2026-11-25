import { readdir, readFile } from 'node:fs/promises'
import { join, normalize, dirname } from 'node:path'
import ts from 'typescript'

/** Every .ts and .tsx file under `root`, with its source. */
export async function sourceFiles(root: string): Promise<{ path: string; source: string }[]> {
  const entries = await readdir(root, { withFileTypes: true, recursive: true })
  const files = entries
    .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
  return Promise.all(files.map(async (path) => ({ path, source: await readFile(path, 'utf8') })))
}

/** Static, type-only, re-export and dynamic import specifiers of one file. */
function specifiers(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, false)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      found.push(node.moduleSpecifier.text)
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      found.push(node.arguments[0].text)
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      found.push(node.argument.literal.text)
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

/** Repository path an import points to (`src/...`), or null for a package. */
function target(from: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return normalize(join('src', specifier.slice(2)))
  if (specifier === '@payload-config') return 'src/payload.config.ts'
  if (specifier.startsWith('.')) return normalize(join(dirname(from), specifier))
  return null
}

/** Repository paths (`src/...`) one file imports, packages left out (scripts/remove-module.mjs). */
export const importedPaths = (path: string, source: string): string[] =>
  specifiers(path, source).flatMap((specifier) => target(path, specifier) ?? [])

const moduleOf = (path: string) => /^src\/modules\/([^/]+)\//.exec(path)?.[1]

/**
 * Layer rules: the core imports nothing from modules, the site layer, routes or scripts; a module
 * imports another module only if it declares it, and nothing from the site layer, routes, scripts
 * or the module registry. Messages read "<path>: <reason> (<specifier>)".
 */
export function importViolations(
  files: readonly { path: string; source: string }[],
  dependencies: Record<string, readonly string[]>,
): string[] {
  const violations: string[] = []
  for (const { path, source } of files) {
    const own = moduleOf(path)
    for (const specifier of specifiers(path, source)) {
      const to = target(path, specifier)
      if (!to) continue
      if (path.startsWith('src/core/')) {
        if (/^src\/(modules|site|app|scripts)(\/|$)/.test(to))
          violations.push(`${path}: le core importe une couche supérieure (${specifier})`)
        continue
      }
      if (!own) continue
      if (to === 'src/modules/index.ts' || to === 'src/modules' || to === 'src/modules/index')
        violations.push(`${path}: un module importe le registre (${specifier})`)
      else if (/^src\/(site|app|scripts)(\/|$)/.test(to))
        violations.push(`${path}: un module importe la couche du site (${specifier})`)
      else {
        const other = moduleOf(to + '/')
        if (other && other !== own && !(dependencies[own] ?? []).includes(other))
          violations.push(`${path}: dépendance non déclarée vers ${other} (${specifier})`)
      }
    }
  }
  return violations
}

const forbiddenIdentifiers = [
  'process',
  'Buffer',
  'fetch',
  'Request',
  'Response',
  'FormData',
  'File',
  'Payload',
  'PayloadRequest',
  'Stripe',
]
const hexagonLayer = (path: string) =>
  /^src\/modules\/([^/]+)\/(domain|application)\//.exec(path) as
    (RegExpExecArray & [string, string, 'domain' | 'application']) | null

/**
 * Hexagon rule for every `src/modules/<name>/{domain,application}` file: it imports only from a
 * `domain` or `application` folder (a domain file only from a `domain` folder), of its own module
 * or a declared one; never a package, the core or an adapter. No system clock, randomness,
 * `require` or infrastructure identifier either.
 */
export function hexagonViolations(
  files: readonly { path: string; source: string }[],
  dependencies: Record<string, readonly string[]>,
): string[] {
  const violations: string[] = []
  for (const { path, source } of files) {
    const layer = hexagonLayer(path)
    if (!layer) continue
    const [, own, kind] = layer
    const allowed = kind === 'domain' ? ['domain'] : ['domain', 'application']
    for (const specifier of specifiers(path, source)) {
      const to = target(path, specifier)
      const into = to ? hexagonLayer(to + (to.endsWith('.ts') ? '' : '/')) : null
      if (!to) violations.push(`${path}: import d’un paquet (${specifier})`)
      // src/core/domain is the shared kernel: pure code that every module domain may import.
      else if (to.startsWith('src/core/domain/')) continue
      else if (!into || !allowed.includes(into[2]))
        violations.push(`${path}: dépendance sortante (${specifier})`)
      else if (into[1] !== own && !(dependencies[own] ?? []).includes(into[1]))
        violations.push(`${path}: dépendance non déclarée vers ${into[1]} (${specifier})`)
    }
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node) => {
      if (
        ts.isImportEqualsDeclaration(node) ||
        (ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) && node.expression.text === 'require')))
      )
        violations.push(`${path}: import dynamique d’infrastructure (${node.getText(file)})`)
      else if (ts.isIdentifier(node) && forbiddenIdentifiers.includes(node.text))
        violations.push(`${path}: identifiant d’infrastructure (${node.text})`)
      else if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Date' &&
        !node.arguments?.length
      )
        violations.push(`${path}: heure système, injecter Clock (${node.getText(file)})`)
      else if (
        ts.isPropertyAccessExpression(node) &&
        ['Date.now', 'Math.random'].includes(node.getText(file))
      )
        violations.push(`${path}: injecter Clock ou Identifiers (${node.getText(file)})`)
      ts.forEachChild(node, visit)
    }
    visit(file)
  }
  return violations
}

/** Shared kernel rule: `src/core/domain/**` imports only other `src/core/domain/**` files. */
export function sharedKernelViolations(
  files: readonly { path: string; source: string }[],
): string[] {
  return files
    .filter(({ path }) => path.startsWith('src/core/domain/'))
    .flatMap(({ path, source }) =>
      specifiers(path, source).flatMap((specifier) => {
        const to = target(path, specifier)
        return to?.startsWith('src/core/domain/')
          ? []
          : [`${path}: le noyau partagé importe hors de src/core/domain (${specifier})`]
      }),
    )
}

/**
 * Removal rule: a file outside src/modules that imports a module is listed by exactly that module
 * (its `routes` or `files`), and imports no other module, or file listed by one, than it and its
 * declared dependencies; so scripts/remove-module.mjs deletes it with the module and leaves no
 * broken import. The registry (src/modules/index.ts) is the only exception.
 */
export function ownershipViolations(
  files: readonly { path: string; source: string }[],
  owners: Record<string, readonly string[]>,
  dependencies: Record<string, readonly string[]>,
): string[] {
  const violations: string[] = []
  const withoutExtension = (path: string) => path.replace(/\.(ts|tsx)$/, '')
  const ownerOf = new Map(
    Object.entries(owners).flatMap(([name, paths]) =>
      paths.map((owned) => [withoutExtension(owned), name] as const),
    ),
  )
  for (const { path, source } of files) {
    if (path.startsWith('src/modules/')) continue
    const owner = ownerOf.get(withoutExtension(path))
    const allowed = owner ? [owner, ...(dependencies[owner] ?? [])] : []
    for (const specifier of specifiers(path, source)) {
      const to = target(path, specifier)
      const imported = to ? (moduleOf(to + '/') ?? ownerOf.get(withoutExtension(to))) : undefined
      if (!imported || allowed.includes(imported)) continue
      violations.push(
        owner
          ? `${path}: appartient à ${owner} mais importe ${imported} (${specifier})`
          : `${path}: importe ${imported} sans figurer dans son manifeste (${specifier})`,
      )
    }
  }
  return violations
}
