import config from '@payload-config'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getPayload, type Payload } from 'payload'
import { cache, type ReactNode } from 'react'
import { requestMaintenance } from '@/core/http/maintenance'
import { isLocale, type Locale } from '@/core/i18n/locales'
import { logger } from '@/core/logger'
import { extensionsOf } from '@/core/modules/resolve'
import { SiteFrame } from '@/site/SiteChrome'
import { viewerFrom, type Viewer } from '@/site/viewer'

/**
 * What a module contributes to the accounts module for the header (`extensions.accounts`, the
 * contract of src/modules/accounts/extension.ts): the name shown for a visitor account. Read
 * through the core's `extensionsOf`, so the site layer imports no module.
 */
interface VisitorNameSource {
  visitorName(args: { payload: Payload; customerId: number }): Promise<string | null>
}
const isVisitorNameSource = (value: unknown): value is VisitorNameSource =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'visitorName') === 'function'

/**
 * The viewer of this request, once per render. Without a cookie, nobody: no lookup at all. With
 * one, Payload's auth strategies decide (the accounts module's resolves a visitor account, never an
 * administrator). Read as same-origin, like the maintenance gate: the header shows the visitor's
 * own state to their own browser, even after a link from elsewhere; the only write is the one an
 * auth strategy may do on a first visit. A failure shows the signed-out header, never an error.
 */
export const requestViewer = cache(async (): Promise<Viewer> => {
  const cookie = (await headers()).get('cookie')
  if (!cookie) return { signedIn: false }
  try {
    const payload = await getPayload({ config })
    const { user } = await payload.auth({
      headers: new Headers({ cookie, 'sec-fetch-site': 'same-origin' }),
    })
    return await viewerFrom(user, async (customerId) => {
      for (const source of extensionsOf(payload, 'accounts', isVisitorNameSource)) {
        const name = await source.visitorName({ payload, customerId })
        if (name) return name
      }
      return null
    })
  } catch (error) {
    logger.error({ err: error }, 'Lecture du visiteur de l’en-tête en échec')
    return { signedIn: false }
  }
})

/**
 * A public page in the site's frame: header (with the viewer's state, rendered on the server, so
 * no flash and nothing to hydrate differently), `<main>`, footer. `paths` is the same page in each
 * language, for FR · EN (the homepage by default). While visitors are kept out, the `[locale]`
 * layout shows the maintenance page in the frame instead: nothing here runs, no session is read.
 */
export async function PublicShell({
  locale,
  paths,
  children,
}: {
  locale: string
  paths?: Record<Locale, string> | undefined
  children: ReactNode
}) {
  if (!isLocale(locale)) notFound()
  if ((await requestMaintenance()).visitorBlocked) return null
  return (
    <SiteFrame locale={locale} paths={paths} viewer={await requestViewer()}>
      {children}
    </SiteFrame>
  )
}

/**
 * A page component wrapped in PublicShell, for the route files of module pages (a module cannot
 * import the site layer): `paths` gives FR · EN from the route's params.
 */
export function shellPage<Props extends { params: Promise<{ locale: string }> }>(
  Page: (props: Props) => ReactNode | Promise<ReactNode>,
  paths?: (params: Awaited<Props['params']>) => Record<Locale, string>,
) {
  return async function ShellPage(props: Props) {
    const params = await props.params
    return (
      <PublicShell locale={params.locale} paths={paths?.(params as Awaited<Props['params']>)}>
        <Page {...props} />
      </PublicShell>
    )
  }
}

/** A path segment of the route's params as written in the URL, decoded (or empty if malformed). */
export function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}
