// The per-site values (slug, its first part, display name, domain, deploy directory, default host,
// port) must only be written in the site configuration and the files allowed below. Shared by
// tests/site-values.test.ts and scripts/init-site.mjs, which refuses a value the generic code
// already contains, so the owner learns of it at init time and not from a failing test.
//
// A value matches as a whole word, case-insensitively: not preceded or followed by a letter or a
// digit. A slug matches in `<slug>-prod` or `'<slug>'`, never inside a longer word of generic text
// (a French slug is often part of ordinary words), and a port never inside a longer number.

/** Files where per-site values belong (paths relative to the repository root). */
export const allowed = [
  /^site\.config\.json$/,
  /^package\.json$/,
  /^pnpm-lock\.yaml$/,
  /^docker-compose\.yml$/,
  /^\.env\.example$/,
  /\.md$/,
  /^public\//,
  /^src\/migrations\//,
  /^src\/site\//,
  /^src\/payload-types\.ts$/,
  // Fixtures of the starter's init script (other sites' slugs, ports, domains); skipped once initialised.
  /^tests\/init-site\.test\.ts$/,
  // Fixtures of the matching itself.
  /^tests\/site-values\.test\.ts$/,
]

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The values to look for, in a stable order and without duplicates. The starter's own placeholders
 * (slug `example`, name `Example`, a `.invalid` domain) are the reserved example names every test
 * fixture uses: only its distinctive values are checked until the site is initialised.
 * @param {{ slug: string, identity: { displayName: string, domain: string },
 *   app: { port: number }, deploy: { directory: string, defaultHost: string },
 *   analytics?: { websiteId: string } | null | undefined }} config
 * @returns {string[]}
 */
export function siteValues(config) {
  const placeholders = config.identity.domain.endsWith('.invalid')
  const values = [
    ...(placeholders
      ? []
      : [config.slug, config.slug.split('-')[0] ?? config.slug, config.identity.displayName]),
    config.identity.domain,
    config.deploy.directory,
    config.deploy.defaultHost,
    String(config.app.port),
    // The analytics website id is per site too (site.config.json `analytics`).
    ...(config.analytics ? [config.analytics.websiteId] : []),
  ]
  return [...new Set(values.filter(Boolean))]
}

/**
 * Every line of `entries` ([path, text]) that holds a value of `config`, once per value.
 * @param {Parameters<typeof siteValues>[0]} config
 * @param {Iterable<[string, string]>} entries
 * @returns {{ path: string, line: number, value: string }[]}
 */
export function siteValueOffenders(config, entries) {
  const patterns = siteValues(config).map((value) => ({
    value,
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escape(value)}(?![\\p{L}\\p{N}])`, 'iu'),
  }))
  const found = []
  for (const [path, text] of entries)
    text.split('\n').forEach((content, index) => {
      for (const { value, pattern } of patterns)
        if (pattern.test(content)) found.push({ path, line: index + 1, value })
    })
  return found
}

/** @param {string} path */
export const isAllowed = (path) => allowed.some((pattern) => pattern.test(path))
