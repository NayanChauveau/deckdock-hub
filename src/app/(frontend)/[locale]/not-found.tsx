import Link from 'next/link'
import { headers } from 'next/headers'
import { messages } from '@/site/messages'
import { LOCALE_HEADER } from '@/proxy'
import { site } from '@/core/site'

// Rendered on the server so unknown URLs answer a real 404; not-found has no params, the proxy passes the language.
export default async function NotFound() {
  const locale = (await headers()).get(LOCALE_HEADER) === 'en' ? 'en' : 'fr'
  const t = messages[locale]
  return (
    <main className="state-screen">
      <title>{`${t.notFound} | ${site.identity.displayName}`}</title>
      <p className="eyebrow">{site.identity.displayName} · 404</p>
      <h1>{t.notFound}</h1>
      <p>{t.notFoundText}</p>
      <Link className="text-link" href={`/${locale}`}>
        {t.back} <span aria-hidden="true">↗</span>
      </Link>
    </main>
  )
}
