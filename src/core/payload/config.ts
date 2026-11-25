import path from 'node:path'
import sharp from 'sharp'
import { config as loadEnv } from 'dotenv'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { buildConfig, type GlobalConfig, type SanitizedConfig } from 'payload'
import { fr } from '@payloadcms/translations/languages/fr'
import { isVerifiedAdmin } from '@/core/payload/access'
import { restrictPayloadInternals } from '@/core/payload/internal-access'
import { Media } from '@/core/payload/collections/Media'
import { Users } from '@/core/payload/collections/Users'
import { LegalPages } from '@/core/payload/globals/LegalPages'
import { SiteSettings } from '@/core/payload/globals/SiteSettings'
import { authEmailAdapter } from '@/core/email/auth-email'
import { logger } from '@/core/logger'
import { totpPlugins } from '@/core/admin/totp'
import { ADMIN_GUARD_PROVIDER, UNAUTHORIZED_VIEW } from '@/core/admin/admin-guard'
import { resolveModules } from '../modules/resolve'
import type { SiteModule } from '../modules/types'
import { devOrigin, site } from '../site'

/**
 * The Payload configuration of a site: the core (users with two-factor login, media, settings,
 * legal pages, jobs, email, database, languages) plus what each module brings.
 */
export function buildSiteConfig(options: {
  modules: readonly SiteModule[]
  globals?: readonly GlobalConfig[]
  baseDir: string
}): Promise<SanitizedConfig> {
  if (process.env.NODE_ENV !== 'production') loadEnv({ path: '.env.local', quiet: true })
  const secret = process.env['PAYLOAD_SECRET']
  const connectionString = process.env['DATABASE_URL']
  if (!secret || secret.length < 32)
    throw new Error('PAYLOAD_SECRET doit contenir au moins 32 caractères.')
  if (!connectionString) throw new Error('DATABASE_URL est requis.')
  const appURL = process.env['APP_URL'] || (process.env.NODE_ENV !== 'production' ? devOrigin : '')
  if (!appURL) throw new Error('APP_URL est requis en production.')
  const origin = new URL(appURL)
  if (origin.origin !== appURL || origin.username || origin.password)
    throw new Error('APP_URL doit être une origine sans chemin.')
  if (
    process.env.NODE_ENV === 'production' &&
    origin.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(origin.hostname)
  )
    throw new Error('HTTPS est requis en production.')

  const resolved = resolveModules(options.modules)
  const autoRun = process.env['JOBS_AUTORUN'] === 'true'
  const config = buildConfig({
    secret,
    sharp,
    // JSON logs (one line per event, errors with their stack) for Grafana: see src/core/logger.ts.
    logger,
    serverURL: appURL,
    csrf: [appURL],
    admin: {
      user: Users.slug,
      importMap: { baseDir: options.baseDir },
      // First provider, so before payload-totp's: a visitor never reaches its enrolment redirect.
      components: {
        providers: [ADMIN_GUARD_PROVIDER],
        // Its button suits the session: Payload's logout cannot end a visitor's (admin-guard.ts).
        views: { unauthorized: { Component: UNAUTHORIZED_VIEW } },
        beforeDashboard: [...resolved.dashboard],
      },
      // Payload's built-in avatar instead of Gravatar: no hash of the admin's email sent to a third
      // party, and nothing loaded from outside under the CSP (src/core/http/csp.ts).
      avatar: 'default',
    },
    collections: [Users, Media, ...resolved.collections],
    globals: [...(options.globals ?? []), ...resolved.globals, SiteSettings, LegalPages],
    upload: { limits: { fileSize: 10 * 1024 * 1024 } },
    // No route mounts it and the administration does not use it: off, so that adding the route by
    // mistake does not open resolvers that bypass the REST guards (restrictPayloadInternals).
    graphQL: { disable: true },
    jobs: {
      // Not wrapped by payload-totp: a password-only session must not run or queue jobs either.
      access: {
        run: ({ req }) => isVerifiedAdmin(req),
        queue: ({ req }) => isVerifiedAdmin(req),
        cancel: ({ req }) => isVerifiedAdmin(req),
      },
      deleteJobOnComplete: true,
      // One job per minute and per queue, run by the web container only (JOBS_AUTORUN=true).
      autoRun: autoRun
        ? resolved.queues.map((queue) => ({ cron: '* * * * *', queue, limit: 1 }))
        : [],
      tasks: resolved.tasks,
    },
    email: authEmailAdapter(),
    editor: lexicalEditor(),
    db: postgresAdapter({
      pool: { connectionString, connectionTimeoutMillis: 5000 },
      migrationDir: path.resolve(options.baseDir, 'migrations'),
      push: false,
    }),
    i18n: { supportedLanguages: { fr }, fallbackLanguage: 'fr' },
    localization: {
      locales: [...site.identity.locales],
      defaultLocale: site.identity.defaultLocale,
      fallback: true,
    },
    typescript: { outputFile: path.resolve(options.baseDir, 'payload-types.ts') },
    // Server-only wiring between modules (extensionsOf in src/core/modules/resolve.ts).
    custom: { site: { extensions: resolved.extensions } },
    // Second factor for every administrator (TOTP), last so that it wraps every collection.
    plugins: totpPlugins(),
  })
  // Payload's own collections, added during sanitization, stay closed to visitor sessions.
  return config.then(restrictPayloadInternals)
}
