import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { requestMaintenance } from '@/core/http/maintenance'
import { robots } from '@/core/http/seo'
import { isLocale, type Locale } from '@/core/i18n/locales'
import { messages } from '@/core/i18n/messages'
import { site } from '@/core/site'
import { accountMessages } from '../messages'

export interface AccountPageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ error?: string | string[] }>
}

type Page = 'signIn' | 'account' | 'deleted'

/**
 * Private pages: a plain title, never the visitor's details, and never indexed. During maintenance
 * the neutral title of the maintenance page; its text belongs to the site layer, out of a module's
 * reach, so these pages carry no description.
 */
export function accountMetadata(page: Page) {
  return async ({ params }: Pick<AccountPageProps, 'params'>): Promise<Metadata> => {
    const { locale } = await params
    if (!isLocale(locale)) return {}
    const title = (await requestMaintenance()).visitorBlocked
      ? messages[locale].maintenanceTitle
      : accountMessages[locale][page].title
    return { title: `${title} | ${site.identity.displayName}`, robots: robots(false) }
  }
}

/**
 * The page of a known language. While visitors are kept out, the `[locale]` layout shows the
 * maintenance page in its place (with the site's text): nothing of the account runs, no session
 * is read and no redirect reveals anything.
 */
export async function accountPage(
  { params }: Pick<AccountPageProps, 'params'>,
  render: (locale: Locale) => Promise<ReactNode> | ReactNode,
): Promise<ReactNode> {
  const { locale } = await params
  if (!isLocale(locale)) notFound()
  if ((await requestMaintenance()).visitorBlocked) return null
  return render(locale)
}

/** The one `error` of the address, if any. */
export async function errorParam({ searchParams }: Pick<AccountPageProps, 'searchParams'>) {
  const { error } = await searchParams
  return typeof error === 'string' ? error : undefined
}
