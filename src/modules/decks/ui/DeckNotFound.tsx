import Link from 'next/link'
import { headers } from 'next/headers'
import { LOCALE_HEADER, PATHNAME_HEADER } from '@/core/http/proxy'
import { site } from '@/core/site'
import { catalogueMessages } from '../catalogue-messages'
import { cataloguePath } from '../paths'
import { deckGone } from '../server'
import { sitePayload } from './session'

/**
 * The deck page's not-found boundary: "withdrawn" for a hidden deck, "not found" otherwise (an
 * unknown deck, or a pending one shown to someone else than its author). Next.js pages cannot
 * answer 410, so both are 404 pages; the add-on's addresses (`/d/…`) do answer 410 when hidden.
 * Not-found boundaries get no params: the address comes from the proxy's request headers.
 */
export default async function DeckNotFound() {
  const request = await headers()
  const locale = request.get(LOCALE_HEADER) === 'en' ? 'en' : 'fr'
  const t = catalogueMessages[locale].deck
  const [, , d, handle, deckId] = (request.get(PATHNAME_HEADER) ?? '').split('/')
  const gone =
    d === 'd' && handle && deckId
      ? await deckGone(await sitePayload(), {
          handle: safeDecode(handle),
          deckId: safeDecode(deckId),
        }).catch(() => false)
      : false
  const [title, text] = gone ? [t.goneTitle, t.goneText] : [t.missingTitle, t.missingText]
  return (
    <main className="state-screen">
      <title>{`${title} | ${site.identity.displayName}`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <p className="eyebrow">{site.identity.displayName} · 404</p>
      <h1>{title}</h1>
      <p>{text}</p>
      <Link className="text-link" href={cataloguePath(locale)}>
        {t.catalogue}
      </Link>
    </main>
  )
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment)
  } catch {
    return ''
  }
}
