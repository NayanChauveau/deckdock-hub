import { headers } from 'next/headers'
import { InlineScript } from './InlineScript'
import { themeBootScript } from './preference'

/**
 * The theme boot script, in the public layout's <head>. It carries the nonce of the request's
 * Content Security Policy (src/core/http/proxy.ts), read the way src/core/ui/Analytics.tsx reads it,
 * so script-src needs no 'unsafe-inline'. It runs from the server HTML only (InlineScript): on client
 * navigations the `dark` class is already on <html>, and ThemeSync re-applies it.
 */
export async function ThemeScript() {
  const nonce = /'nonce-([^']+)'/.exec((await headers()).get('content-security-policy') ?? '')?.[1]
  return <InlineScript html={themeBootScript()} nonce={nonce} />
}
