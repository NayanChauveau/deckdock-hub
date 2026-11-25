import './zod'
import { z } from 'zod'
import raw from '../../site.config.json'

/**
 * Every per-site value lives in site.config.json (repository root). The consistency rules below
 * are the copied-site guard: a configuration edited only in part (new slug, old directory, volumes
 * or routers of another site) is refused before anything reads it.
 */
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
const secretName = z.string().regex(/^[A-Z][A-Z0-9_]*$/)
const seconds = z.number().int().min(1).max(900)

const schema = z.object({
  slug,
  identity: z.object({
    displayName: z.string().min(1),
    domain: z.string().min(1),
    locales: z.array(z.string().min(2)).min(1),
    defaultLocale: z.string().min(2),
  }),
  app: z.object({
    port: z.number().int().min(1024).max(65535),
    logService: z.string().min(1),
    userAgent: z.string().min(1),
  }),
  // One section per module that reads settings; absent when the site does not have the module.
  modules: z.object({
    orders: z
      .object({
        referencePrefix: z.string().regex(/^[A-Z]{2,6}$/),
        accessCookiePrefix: z.string().min(1),
        trackingPath: z.string().startsWith('/'),
        accessPath: z.string().startsWith('/'),
      })
      .optional(),
  }),
  deploy: z.object({
    directory: z.string(),
    composeProject: z.string(),
    imageRepository: z.string().regex(/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/),
    volumeOwnerLabel: z.string().regex(/^[a-z0-9-]+\.owner$/),
    volumes: z.object({
      database: z.string(),
      media: z.string().nullable(),
      legacyDatabase: z.string().nullable(),
    }),
    database: z.object({ name: z.string().min(1), user: z.string().min(1) }),
    traefikName: z.string(),
    defaultHost: z.string().min(1),
    protectedHosts: z.array(z.string().min(1)),
    protectedHealthUrl: z.url(),
    // Deploy kit options, read by deploy/site_config.py (which holds the full rules).
    opsJobs: z.array(slug),
    requiredSecrets: z.array(secretName).optional(),
    optionalSecrets: z.array(secretName).optional(),
    payments: z.boolean().optional(),
    email: z.boolean().optional(),
    quietWindow: z.boolean(),
    wwwRedirect: z.boolean(),
    timings: z
      .object({
        settleSeconds: seconds.optional(),
        drainSeconds: seconds.optional(),
        healthTimeoutSeconds: seconds.optional(),
      })
      .strict()
      .optional(),
  }),
  // Read by deploy/smoke.py (deploy/site_config.py holds the full rules).
  smoke: z
    .object({
      pages: z
        .array(z.object({ path: z.string().startsWith('/'), contains: z.string().min(1) }).strict())
        .min(1),
      extension: z.string().optional(),
    })
    .strict(),
  github: z.object({ secrets: z.array(z.string()), variables: z.array(z.string()) }),
  // Audience measurement (self-hosted Umami, src/core/http/analytics.ts); null or absent: off.
  analytics: z
    .object({
      host: z
        .url({ protocol: /^https$/ })
        .refine((value) => URL.canParse(value) && new URL(value).origin === value, 'origin'),
      websiteId: z.uuid(),
    })
    .strict()
    .nullable()
    .optional(),
})

export type SiteConfig = z.infer<typeof schema>

/** Validates a raw configuration; throws an Error naming the faulty key. */
export function parseSite(input: unknown): SiteConfig {
  const result = schema.safeParse(input)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new Error(`site.config.json: ${issue ? issue.path.join('.') : '?'} invalide`)
  }
  const config = result.data
  const { deploy } = config
  const rules: [string, boolean][] = [
    ['deploy.directory', deploy.directory === `/srv/${config.slug}`],
    ['deploy.composeProject', deploy.composeProject === `${config.slug}-prod`],
    ['deploy.traefikName', deploy.traefikName === config.slug],
    [
      'deploy.volumes',
      Object.values(deploy.volumes).every(
        (volume) => volume === null || volume.startsWith(`${deploy.composeProject}-`),
      ),
    ],
    ['deploy.defaultHost', !deploy.protectedHosts.includes(deploy.defaultHost)],
    ['identity.defaultLocale', config.identity.locales.includes(config.identity.defaultLocale)],
  ]
  for (const [key, ok] of rules)
    if (!ok) throw new Error(`site.config.json: ${key} ne correspond pas au slug ${config.slug}`)
  return config
}

export const site: SiteConfig = parseSite(raw)

/** Local development origin (next dev, tests). */
export const devOrigin = `http://localhost:${site.app.port}`
