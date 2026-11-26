import { headers } from 'next/headers'
import { LOCALE_HEADER, PATHNAME_HEADER } from '@/core/http/proxy'
import DeckNotFound from '@/modules/decks/ui/DeckNotFound'
import { PublicShell } from '@/site/PublicShell'

// Not-found boundaries get no params: the language and the address come from the proxy.
export default async function NotFound() {
  const request = await headers()
  const locale = request.get(LOCALE_HEADER) === 'en' ? 'en' : 'fr'
  // The deck's address is the same in both languages, after the language segment.
  const rest = (request.get(PATHNAME_HEADER) ?? '').replace(/^\/(fr|en)(?=\/|$)/, '')
  return (
    <PublicShell locale={locale} paths={{ fr: `/fr${rest}`, en: `/en${rest}` }}>
      <DeckNotFound />
    </PublicShell>
  )
}
