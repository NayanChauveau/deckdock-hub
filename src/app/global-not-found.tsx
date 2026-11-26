import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { LOCALE_HEADER } from '@/proxy'
import Layout, { generateMetadata as layoutMetadata } from './(frontend)/[locale]/layout'
import NotFound from './(frontend)/[locale]/not-found'

// Any URL no route matches (under /fr or /en: the proxy has already rewritten the legal pages'
// slugs). Next renders this file on the server with a real 404, in place of an error shell that
// would skip the public layout's <head> (theme boot script, so a dark flash) until hydration.
// It reuses that layout as is; the language comes from the proxy, since there are no params.
const params = async () => ({
  locale: (await headers()).get(LOCALE_HEADER) === 'en' ? 'en' : 'fr',
})

export async function generateMetadata(): Promise<Metadata> {
  return layoutMetadata({ params: params() })
}

export default function GlobalNotFound() {
  return (
    <Layout params={params()}>
      <NotFound />
    </Layout>
  )
}
