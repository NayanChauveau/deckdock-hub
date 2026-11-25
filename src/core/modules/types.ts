import type { CollectionConfig, GlobalConfig, TaskConfig } from 'payload'

/**
 * An optional part of the site (orders, payment, uploads…). A site keeps or deletes a module by
 * its one line in src/modules/index.ts; the core never imports a module (tests/architecture.test.ts).
 */
export interface SiteModule {
  name: string
  dependsOn: readonly string[]
  collections?: readonly CollectionConfig[]
  globals?: readonly GlobalConfig[]
  /** Payload job tasks. */
  tasks?: readonly TaskConfig[]
  /** Job queues run every minute by the web container when JOBS_AUTORUN=true. */
  queues?: readonly string[]
  /** Files under src/app that only re-export this module's handlers or pages. */
  routes?: readonly string[]
  /**
   * The other files outside src/modules that exist only for this module (pages, scripts, tests),
   * deleted with it by scripts/remove-module.mjs (tests/architecture.test.ts checks the list).
   */
  files?: readonly string[]
  /**
   * Deploy secrets that only this module reads (`deploy.requiredSecrets` and `github.secrets` of
   * site.config.json). scripts/remove-module.mjs takes them out of the configuration and the deploy
   * files with the module; `pnpm starter:add` names them (starter.json lists them too).
   */
  secrets?: readonly string[]
  /**
   * This module's migrations (names in src/migrations). A deployed site keeps them and adds a
   * removal migration; a site that never deployed the module deletes them
   * (`pnpm module:remove --delete-migrations`, which init-site uses).
   */
  migrations?: readonly string[]
  /**
   * Payload component paths (`/modules/x/admin/Y#Y`) rendered above the admin dashboard, for the
   * panels this module wants the administrator to see first.
   */
  dashboard?: readonly string[]
  /** One sample of each email this module sends, for the email test workflow (`previews`). */
  emailPreviews?(site: string): readonly { subject: string; body: string; html?: string }[]
  /** What this module contributes to another one, keyed by the target module's name. */
  extensions?: Readonly<Record<string, unknown>>
  /** Called once all modules are known; returns what depends on the extensions received. */
  setup?(context: {
    extensionsFor(target: string): readonly unknown[]
  }): Pick<SiteModule, 'collections' | 'globals' | 'tasks'>
}
