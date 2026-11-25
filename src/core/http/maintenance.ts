import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { cache } from 'react'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { Locale } from '@/core/i18n/locales'
import { messages } from '@/core/i18n/messages'
import { robots } from './seo'
import { canSeeThroughMaintenance } from '@/core/payload/access'
import { totpDisabled } from '@/core/admin/totp'
import { site } from '@/core/site'

export interface MaintenanceState {
  /** The "Site en maintenance" box is ticked in the administration. */
  active: boolean
  /** The request comes from a visitor who must see the maintenance page instead of the site. */
  visitorBlocked: boolean
}

/**
 * Maintenance is on until an administrator unticks it; signed-in administrators (password and TOTP
 * code) always see the real site so that they can test it. Any failure fails closed: an unreadable state never opens the shop.
 */
export async function maintenanceState(requestHeaders: Headers): Promise<MaintenanceState> {
  try {
    const payload = await getPayload({ config })
    const settings = await payload.findGlobal({ slug: 'site-settings', depth: 0 })
    if (settings.maintenance === false) return { active: false, visitorBlocked: false }
    const cookie = requestHeaders.get('cookie')
    if (!cookie) return { active: true, visitorBlocked: true }
    // Read as same-origin to decide visibility: an administrator following an email link (cross-site
    // navigation) must still see the real site. Only what an auth strategy does on a first visit can
    // be written here (a module may create its own record, such as a visitor's `customers`
    // document); Payload's CSRF check stays in force for every state-changing call, and the public
    // commerce endpoints keep their own same-origin check.
    const { user } = await payload.auth({
      headers: new Headers({ cookie, 'sec-fetch-site': 'same-origin' }),
    })
    return { active: true, visitorBlocked: !canSeeThroughMaintenance(user, totpDisabled()) }
  } catch {
    return { active: true, visitorBlocked: true }
  }
}

/** One read per page render, shared by the layout gate and the page metadata. */
export const requestMaintenance = cache(async () => maintenanceState(await headers()))

/**
 * Neutral metadata for visitors: no title, description or image of the real pages may leak.
 * `description` is the site's own maintenance text.
 */
export async function maintenanceMetadata(
  locale: Locale,
  description: string,
): Promise<Metadata | null> {
  if (!(await requestMaintenance()).visitorBlocked) return null
  const t = messages[locale]
  return {
    title: `${t.maintenanceTitle} | ${site.identity.displayName}`,
    description,
    robots: robots(false),
  }
}

/** Answer of public commerce endpoints while visitors are kept out; webhooks and health stay open. */
export function maintenanceResponse() {
  return Response.json(
    { error: 'maintenance' },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3600' } },
  )
}
