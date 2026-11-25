import type { SiteConfig } from '../site'

/**
 * Audience measurement with the self-hosted Umami of the infrastructure (cookieless; contract in
 * infra-traefik's README, "Statistiques (Umami)"). Off unless site.config.json has `analytics`,
 * and only in production builds: next dev and the test suites never load the tracker.
 *
 * The tracker runs on public pages only (the [locale] layout), never in the administration. It
 * sends the page address with its query string, so that utm_* campaigns are recorded; Umami's
 * `data-exclude-search` would drop them too. A filter (window.umamiBeforeSend) trims every
 * address instead: only utm_* parameters are kept, the fragment is removed, and the private
 * order pages (tracking links carry the order reference, the access page) are never sent, not
 * even as the referrer of the next page.
 */
export type Analytics = NonNullable<SiteConfig['analytics']>

/** Name of the tracker's `data-before-send` function. */
export const BEFORE_SEND = 'umamiBeforeSend'

export function activeAnalytics(
  config: Partial<Pick<SiteConfig, 'analytics'>>,
  nodeEnv: string | undefined,
): Analytics | null {
  return nodeEnv === 'production' ? (config.analytics ?? null) : null
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Paths of the order tracking and access pages, from their configured templates (null: no orders). */
export function privatePaths(config: {
  identity: { locales: string[] }
  modules: { orders?: { trackingPath: string; accessPath: string } | undefined }
}): RegExp | null {
  if (!config.modules.orders) return null
  const locale = `(?:${config.identity.locales.map(escape).join('|')})`
  const { trackingPath, accessPath } = config.modules.orders
  const paths = [trackingPath, accessPath].map((template) =>
    escape(template)
      .replace(/\\\{locale\\\}/g, locale)
      .replace(/\\\{reference\\\}/g, '[^/]+'),
  )
  return new RegExp(`^(?:${paths.join('|')})(?:/|$)`)
}

/** The filter, as an inline script (ES2017, run before the deferred tracker). */
export function beforeSendScript(privatePattern: RegExp | null): string {
  const pattern = privatePattern ? `new RegExp(${JSON.stringify(privatePattern.source)})` : 'null'
  return `window.${BEFORE_SEND}=function(){var p=${pattern};function clean(v){if(!v)return v;var u;try{u=new URL(v,location.href)}catch(e){return ""}if(p&&p.test(u.pathname))return null;var q=new URLSearchParams();u.searchParams.forEach(function(x,k){if(/^utm_/i.test(k))q.append(k,x)});u.search=q.toString();u.hash="";return v.charAt(0)==="/"?u.pathname+u.search:u.href}return function(t,d){if(!d||!("url" in d))return d;var url=clean(d.url);if(url===null)return null;var r=clean(d.referrer);return Object.assign({},d,{url:url,referrer:r===null?"":r})}}();`
}

/** Props of the two script tags of the public layout (null when analytics is off). */
export function analyticsScripts({
  analytics,
  nonce,
  domain,
  privatePattern,
}: {
  analytics: Analytics | null
  nonce: string | undefined
  /** The site's domain: copies served elsewhere (previews, local builds) send nothing. */
  domain: string
  privatePattern: RegExp | null
}) {
  if (!analytics) return null
  return [
    { nonce, dangerouslySetInnerHTML: { __html: beforeSendScript(privatePattern) } },
    {
      defer: true,
      nonce,
      src: `${analytics.host}/script.js`,
      'data-website-id': analytics.websiteId,
      'data-domains': `${domain},www.${domain}`,
      'data-do-not-track': 'true',
      'data-before-send': BEFORE_SEND,
    },
  ] as const
}

/**
 * Revenue (Umami's Revenue and Attribution reports): after a completed payment, the order page
 * sends one event with the amount and currency, from the browser so that Umami ties it to the
 * visit and its source (utm_*, referrer). Nothing else about the order: the address becomes the
 * locale's home (the order page is private) and the referrer (the payment page) is dropped.
 */
export const PURCHASE_EVENT = 'purchase'

export interface Purchase {
  locale: string
  amountCents: number
  currency: string
}

type Payload = Record<string, unknown>

export function purchaseEvent(props: Payload, { locale, amountCents, currency }: Purchase) {
  return {
    ...props,
    url: `/${locale}`,
    referrer: '',
    name: PURCHASE_EVENT,
    data: { revenue: amountCents / 100, currency },
  }
}

interface PurchaseWindow {
  umami?: { track: (payload: (props: Payload) => Payload) => unknown } | undefined
  localStorage: Pick<Storage, 'getItem' | 'setItem'>
}

/**
 * Sends the purchase once per browser: a reload of the order page, or its link opened again, does
 * not count it twice. 'no-tracker': the tracker is not loaded yet (or is blocked, or Do Not Track
 * left it out); the caller may try again.
 */
export function reportPurchase(
  window: PurchaseWindow,
  reference: string,
  purchase: Purchase,
): 'sent' | 'already' | 'no-tracker' {
  const key = `${PURCHASE_EVENT}:${reference}`
  const storage = {
    get: () => {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },
    set: () => {
      try {
        window.localStorage.setItem(key, '1')
      } catch {
        // Private window or storage blocked: sent anyway, at worst counted twice on reload.
      }
    },
  }
  if (storage.get()) return 'already'
  if (!window.umami) return 'no-tracker'
  window.umami.track((props) => purchaseEvent(props, purchase))
  storage.set()
  return 'sent'
}
