// The starter's pieces (starter.json): which files each piece holds, what it requires, and which
// files are per site (never shared). Standard library only: runs in every site, before
// `pnpm install` (scripts/starter-update.mjs). Design: infra-traefik docs/superpowers/specs/2026-11-23-starter-update-design.md
// in the starter.

/**
 * @typedef {{ requires?: string[], files: string[], dependencies?: string[], module?: string, secrets?: string[], migrations?: string[] }} Piece
 * @typedef {{ pieces: Record<string, Piece>, perSite: string[] }} Manifest
 */

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const compiled = new Map()

/**
 * `*` matches within one path segment, `**` any number of whole segments; everything else is
 * literal (brackets and parentheses of Next.js routes included).
 * @public
 * @param {string} glob @param {string} path
 */
export function matches(glob, path) {
  let pattern = compiled.get(glob)
  if (!pattern) {
    const source = glob
      .split('/')
      .map((segment, index, all) => {
        if (segment === '**') return index === all.length - 1 ? '.+' : '(?:[^/]+/)*'
        const part = segment.split('*').map(escape).join('[^/]*')
        return index === all.length - 1 ? part : `${part}/`
      })
      .join('')
    pattern = new RegExp(`^${source}$`)
    compiled.set(glob, pattern)
  }
  return pattern.test(path)
}

/** @param {string} json @returns {Manifest} */
export function parseManifest(json) {
  const manifest = JSON.parse(json)
  if (!manifest || typeof manifest.pieces !== 'object' || !Array.isArray(manifest.perSite))
    throw new Error('starter.json : « pieces » et « perSite » attendus.')
  for (const [name, piece] of Object.entries(manifest.pieces)) {
    if (!Array.isArray(piece.files)) throw new Error(`starter.json : ${name}.files attendu.`)
    for (const required of piece.requires ?? [])
      if (!(required in manifest.pieces))
        throw new Error(`starter.json : ${name} requiert ${required}, qui n’existe pas.`)
  }
  for (const name of Object.keys(manifest.pieces)) withRequired(manifest, [name])
  return manifest
}

/**
 * The pieces named and everything they require, requirements first, each once.
 * @param {Manifest} manifest @param {string[]} names @returns {string[]}
 */
export function withRequired(manifest, names) {
  const ordered = []
  const visit = (name, path) => {
    if (!(name in manifest.pieces)) throw new Error(`Brique inconnue : ${name}.`)
    if (path.includes(name)) throw new Error(`starter.json : cycle ${[...path, name].join(' → ')}.`)
    if (ordered.includes(name)) return
    for (const required of manifest.pieces[name].requires ?? []) visit(required, [...path, name])
    ordered.push(name)
  }
  for (const name of names) visit(name, [])
  return ordered
}

/** @public @param {Manifest} manifest @param {string} path */
export const isPerSite = (manifest, path) => manifest.perSite.some((glob) => matches(glob, path))

/**
 * The piece a file belongs to; null for a per-site file or a file of no piece.
 * @public
 * @param {Manifest} manifest @param {string} path @returns {string | null}
 */
export function pieceOf(manifest, path) {
  if (isPerSite(manifest, path)) return null
  // The most precise pattern wins: an exact path over any pattern, then the longest fixed part
  // before the first `*` (a module's `src/modules/orders/**` over the socle's `src/**`). Two pieces
  // as precise as each other for one file is a manifest error.
  const precision = (glob) => (glob.includes('*') ? glob.indexOf('*') : Infinity)
  const best = Object.entries(manifest.pieces).flatMap(([name, piece]) => {
    const scores = piece.files.filter((glob) => matches(glob, path)).map(precision)
    return scores.length ? [{ name, score: Math.max(...scores) }] : []
  })
  const top = Math.max(-1, ...best.map((entry) => entry.score))
  const owners = best.filter((entry) => entry.score === top).map((entry) => entry.name)
  if (owners.length > 1) throw new Error(`starter.json : ${path} est dans ${owners.join(' et ')}.`)
  return owners[0] ?? null
}

/**
 * The paths that belong to one of `pieces`, without per-site and ignored ones (`ignore` holds
 * paths or patterns), in input order.
 * @param {Manifest} manifest @param {string[]} paths @param {string[]} pieces @param {string[]} ignore
 */
export function sharedFiles(manifest, paths, pieces, ignore) {
  return paths.filter((path) => {
    if (ignore.some((glob) => matches(glob, path))) return false
    const piece = pieceOf(manifest, path)
    return piece !== null && pieces.includes(piece)
  })
}
