import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { buildSiteConfig } from './core/payload/config'
import { SiteContent } from './site/SiteContent'
import { modules } from './modules'

// The site's Payload configuration: the core plus the modules registered in src/modules/index.ts.
export default buildSiteConfig({
  modules,
  globals: [SiteContent],
  baseDir: path.dirname(fileURLToPath(import.meta.url)),
})
