import type { AuthStrategy, Plugin, PayloadHandler } from 'payload'
import { payloadTotp } from 'payload-totp'
import { hasStoredSecret } from '@/core/payload/access'
import { PAYLOAD_TOTP_PROVIDER, TOTP_GATE_PROVIDER } from './admin-guard'
import { requestIP } from './password-links'
import { site } from '@/core/site'

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * The local administrator of `pnpm dev:setup` signs in with a password only, and only when all
 * of these hold: `next dev` (NODE_ENV=development, never a production build or server), a
 * PostgreSQL database on this machine whose name ends with `_dev`, and the explicit flag that
 * `pnpm dev:setup` writes into the local environment file.
 */
export const localDevelopmentWithoutTotp = (environment: NodeJS.ProcessEnv): boolean =>
  environment.NODE_ENV === 'development' &&
  environment['PAYLOAD_TOTP_LOCAL_DEV_BYPASS'] === 'true' &&
  isLocalDevDatabase(environment['DATABASE_URL'])

/** A PostgreSQL database on this machine whose name ends with `_dev` (same rule as scripts/dev-setup.mjs). */
export function isLocalDevDatabase(connectionString: string | undefined): boolean {
  let database: URL
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
 * The second factor is turned off by the test suite (NODE_ENV=test), for the Local API scenarios
 * that act as an administrator without a browser session, and for the local administrator of
 * `pnpm dev:setup` (see above). Production and the HTTP and browser tests all run with it, except
 * the one HTTP stage that checks a visitor on /admin under the local bypass (tests/run.mjs).
 */
export const totpDisabled = (environment: NodeJS.ProcessEnv = process.env): boolean =>
  (environment.NODE_ENV === 'test' && environment['PAYLOAD_TOTP_DISABLED'] === 'true') ||
  localDevelopmentWithoutTotp(environment)

/** Enrolment text: the authenticator app, and a copy of the secret in a password manager. */
export const totpSetupDescription = {
  fr: 'Installez une application d’authentification (Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden…) puis scannez le code QR ci-dessous. <strong>Enregistrez aussi ce code QR, ou la clé affichée par « Ajouter le code manuellement », dans votre gestionnaire de mots de passe</strong> : si vous perdez votre téléphone, vous pourrez toujours générer les codes. Sans cette copie, un autre administrateur devra réinitialiser votre double authentification.',
  en: 'Install an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden…) then scan the QR code below. <strong>Also store this QR code, or the key shown by “Add code manually”, in your password manager</strong>: if you lose your phone, you can still generate the codes. Without that copy, another administrator will have to reset your two-factor authentication.',
} as const

/** payload-totp puts its own texts last; this plugin, listed after it, replaces the enrolment one. */
const setupTexts: Plugin = (config) => {
  const translations: Record<string, unknown> = { ...config.i18n?.translations }
  for (const language of ['fr', 'en'] as const) {
    const current = translations[language]
    if (typeof current !== 'object' || current === null || !('totpPlugin' in current)) continue
    const plugin = current.totpPlugin as { setup?: Record<string, string> }
    translations[language] = {
      ...current,
      totpPlugin: {
        ...plugin,
        setup: { ...plugin.setup, description: totpSetupDescription[language] },
      },
    }
  }
  return { ...config, i18n: { ...config.i18n, translations } }
}

/** Audit log of every successful enrolment: user id and IP, never the secret or the code. */
export function auditSetupTotp(handler: PayloadHandler): PayloadHandler & { audited: true } {
  const audited: PayloadHandler = async (req) => {
    const response = await handler(req)
    try {
      const body: unknown = await response.clone().json()
      if (typeof body === 'object' && body !== null && 'ok' in body && body.ok === true)
        req.payload.logger.info(
          { user: req.user?.id, ip: requestIP(req) },
          'Double authentification configurée.',
        )
    } catch {
      // Not JSON: nothing to log.
    }
    return response
  }
  return Object.assign(audited, { audited: true as const })
}

/**
 * The plugin's TOTP cookie is signed for a user id, not for a secret or a session. After a reset,
 * an old cookie over a fresh password session would count as verified. It only counts while the
 * account has a secret; otherwise Payload falls back to the password session (setup required).
 */
export function requireStoredSecret(strategy: AuthStrategy): AuthStrategy {
  return {
    ...strategy,
    authenticate: async (args) => {
      const result = await strategy.authenticate(args)
      return result.user && hasStoredSecret(result.user) ? result : { user: null }
    },
  }
}

const hardening: Plugin = (config) => ({
  ...config,
  endpoints: (config.endpoints ?? []).map((endpoint) =>
    endpoint.path === '/setup-totp' && endpoint.method === 'post'
      ? { ...endpoint, handler: auditSetupTotp(endpoint.handler) }
      : endpoint,
  ),
  collections: (config.collections ?? []).map((collection) =>
    collection.slug === 'users' && typeof collection.auth === 'object'
      ? {
          ...collection,
          auth: {
            ...collection.auth,
            strategies: (collection.auth.strategies ?? []).map((strategy) =>
              strategy.name === 'totp' ? requireStoredSecret(strategy) : strategy,
            ),
          },
        }
      : collection,
  ),
})

/**
 * Disabled, payload-totp keeps `totpSecret` but drops its virtual `hasTotp` field: Payload would
 * then regenerate src/payload-types.ts without it (next dev regenerates the types), and CI, which
 * generates them with TOTP on, would see a diff. This keeps the same schema either way; the value
 * is never read while the second factor is off.
 */
const sameSchemaWhenDisabled: Plugin = (config) => ({
  ...config,
  collections: (config.collections ?? []).map((collection) =>
    collection.slug === 'users' &&
    !collection.fields.some((field) => 'name' in field && field.name === 'hasTotp')
      ? {
          ...collection,
          fields: [
            ...collection.fields,
            {
              name: 'hasTotp',
              type: 'checkbox',
              virtual: true,
              access: {
                read: ({ data, req: { user } }) => Boolean(data && user && data['id'] === user.id),
              },
              admin: {
                disableBulkEdit: true,
                disableListColumn: true,
                disableListFilter: true,
                hidden: true,
              },
            },
          ],
        }
      : collection,
  ),
})

/**
 * Disabled, payload-totp adds none of its admin components either: `next dev` would then rewrite
 * src/app/(payload)/admin/importMap.js without them, a change that must never be committed (the
 * production admin would lose its second factor screens). For the local administrator without
 * TOTP, `next dev` therefore leaves the import map alone; `pnpm generate:importmap`, which never
 * runs in development mode, regenerates it with the second factor on, as the CI does.
 */
const sameImportMapWhenDisabled =
  (environment: NodeJS.ProcessEnv): Plugin =>
  (config) =>
    localDevelopmentWithoutTotp(environment)
      ? {
          ...config,
          admin: {
            ...config.admin,
            importMap: { ...config.admin?.importMap, autoGenerate: false },
          },
        }
      : config

/** payload-totp's provider entry, with its options, becomes TotpGate (a visitor session skips TOTP). */
const gateProvider: Plugin = (config) => ({
  ...config,
  admin: {
    ...config.admin,
    components: {
      ...config.admin?.components,
      providers: (config.admin?.components?.providers ?? []).map((provider) =>
        typeof provider === 'object' && provider.path === PAYLOAD_TOTP_PROVIDER
          ? { ...provider, path: TOTP_GATE_PROVIDER }
          : provider,
      ),
    },
  },
})

/** Every administrator enrols at the next login (forceSetup), then enters a code at each login. */
export const totpPlugins = (environment: NodeJS.ProcessEnv = process.env): Plugin[] => [
  payloadTotp({
    collection: 'users',
    forceSetup: true,
    disabled: totpDisabled(environment),
    totp: { issuer: site.identity.displayName },
  }),
  sameSchemaWhenDisabled,
  gateProvider,
  sameImportMapWhenDisabled(environment),
  setupTexts,
  hardening,
]
