import { headers } from 'next/headers'
import { activeAnalytics, analyticsScripts, privatePaths } from '@/core/http/analytics'
import { site } from '@/core/site'

/**
 * Audience measurement of the public pages (src/core/http/analytics.ts): nothing unless
 * site.config.json has `analytics` and this is a production build. Both tags carry the nonce of
 * the request's Content Security Policy (src/core/http/proxy.ts).
 */
export async function Analytics() {
  const scripts = analyticsScripts({
    analytics: activeAnalytics(site, process.env.NODE_ENV),
    nonce: /'nonce-([^']+)'/.exec((await headers()).get('content-security-policy') ?? '')?.[1],
    domain: site.identity.domain,
    privatePattern: privatePaths(site),
  })
  if (!scripts) return null
  const [filter, tracker] = scripts
  return (
    <>
      <script {...filter} />
      <script {...tracker} />
    </>
  )
}
