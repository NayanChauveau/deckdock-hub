import type { BrowserContext, Page } from '@playwright/test'

/**
 * Stands in for the audience measurement host (site.config.json `analytics`) in the browser runs
 * on the production build, so that they never depend on the network nor count a visit. The stub
 * tracker does what the real one does under the Content Security Policy: it is loaded from the
 * host with the nonce, runs the page's filter (window.umamiBeforeSend) and posts the visit to
 * {host}/api/send (as text/plain, a simple request: no CORS preflight to answer). `sent` holds
 * the bodies received.
 */
const STUB = `(function(){var s=document.currentScript;var f=window[s.getAttribute('data-before-send')];var d=f('event',{website:s.getAttribute('data-website-id'),url:location.href,referrer:document.referrer});if(d)fetch(s.src.replace(/script\\.js$/,'api/send'),{method:'POST',keepalive:true,body:JSON.stringify({type:'event',payload:d})})})();`

export async function answerAnalytics(target: BrowserContext | Page, host: string | undefined) {
  const sent: unknown[] = []
  if (!host) return { sent }
  await target.route(`${host}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/script.js')
      return route.fulfill({ contentType: 'application/javascript', body: STUB })
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/send') {
      sent.push(request.postDataJSON())
      return route.fulfill({
        contentType: 'application/json',
        body: '{}',
        headers: { 'access-control-allow-origin': '*' },
      })
    }
    return route.fulfill({ status: 404, body: '' })
  })
  return { sent }
}
