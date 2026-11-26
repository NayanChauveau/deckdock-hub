import { present } from './support/present'
import { passwordLogin, totpLogin } from './support/admin-session'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { getPayload } from 'payload'
import config from '../src/payload.config'
import { readPublicSite } from '../src/site/public-site'
import { missingTranslations } from '../src/core/i18n/translation-status'
import { messages } from '../src/site/messages'
import { site } from '../src/core/site'
import { fillEmptyLegalPages, legalPlaceholders } from '../src/site/legal-placeholders'
import { legalPath } from '../src/core/i18n/legal'

if (!new URL(process.env['DATABASE_URL'] || '').pathname.endsWith('_test'))
  throw new Error('Une base isolée finissant par _test est requise.')
const origin = process.env['TEST_ORIGIN'] || 'http://localhost:3201'
const payload = await getPayload({ config })
try {
  const password = randomBytes(24).toString('hex')
  const account = await payload.create({
    collection: 'users',
    data: {
      email: `public-${randomBytes(6).toString('hex')}@example.test`,
      name: 'Test public',
      role: 'admin',
      password,
    },
  })
  const user = { ...account, collection: 'users' as const }
  const options = { overrideAccess: false, user }
  await payload.updateGlobal({
    ...options,
    slug: 'site-content',
    locale: 'fr',
    data: {
      title: 'Portrait de test français',
      description: 'Présentation française uniquement',
      seoTitle: 'SEO français',
    },
  })
  await payload.updateGlobal({
    ...options,
    slug: 'site-settings',
    locale: 'fr',
    data: { siteName: 'Atelier de test', footerText: 'Pied de page français' },
  })
  // The placeholder legal texts of src/site, as `pnpm db:seed` loads them; never overwritten.
  assert.equal(await fillEmptyLegalPages(payload), true)
  assert.equal(await fillEmptyLegalPages(payload), false)
  // A visitor's sign-in request (module accounts); an empty one, so that no email is ever sent.
  const signIn = (cookie?: string) =>
    fetch(`${origin}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: JSON.stringify({}),
    })

  // Maintenance is on by default: visitors see the opening page and cannot sign in, administrators see the site.
  const visitor = await (await fetch(`${origin}/fr`)).text()
  assert.ok(
    visitor.includes(messages.fr.maintenanceTitle),
    'Page de maintenance pour les visiteurs',
  )
  assert.ok(!visitor.includes('Portrait de test français'), 'Contenu masqué pendant la maintenance')
  // The shared header and footer frame it, without the account entry (no session is read).
  assert.equal(visitor.match(/<header/g)?.length, 1, 'En-tête commun sur la page de maintenance')
  assert.equal(
    visitor.match(/<footer/g)?.length,
    1,
    'Pied de page commun sur la page de maintenance',
  )
  assert.equal(visitor.match(/<main/g)?.length, 1, 'Un seul <main>')
  assert.ok(
    !visitor.includes('href="/fr/compte/connexion"'),
    'Pas d’entrée de compte en maintenance',
  )
  const legalDuringMaintenance = await (await fetch(`${origin}/en/privacy`)).text()
  assert.ok(legalDuringMaintenance.includes(messages.en.maintenanceTitle))
  const blockedSignIn = await signIn()
  assert.equal(blockedSignIn.status, 503)
  assert.deepEqual(await blockedSignIn.json(), { error: 'maintenance' })
  assert.equal((await fetch(`${origin}/api/health`)).status, 200, 'Santé joignable')
  // The password alone does not open the shop during maintenance: the TOTP code is required too.
  const passwordOnly = await passwordLogin(origin, account.email, password)
  const unverifiedView = await (
    await fetch(`${origin}/fr`, { headers: { Cookie: passwordOnly } })
  ).text()
  assert.ok(unverifiedView.includes(messages.fr.maintenanceTitle), 'Maintenance sans code TOTP')
  assert.ok(!unverifiedView.includes('Portrait de test français'))
  const session = await totpLogin(origin, account.email, password)
  const adminCookie = session.cookie
  const adminView = await (await fetch(`${origin}/fr`, { headers: { Cookie: adminCookie } })).text()
  assert.ok(adminView.includes('Portrait de test français'), 'Site réel pour un administrateur')
  assert.ok(adminView.includes('Mode maintenance'), 'Bandeau de rappel pour l’administrateur')
  assert.equal(adminView.match(/<header/g)?.length, 1, 'En-tête commun pour l’administrateur')
  // An administrator is not a visitor: the header offers the visitor sign-in.
  assert.ok(adminView.includes('href="/fr/compte/connexion"'), 'Connexion pour un administrateur')
  assert.notEqual(
    (await signIn(adminCookie)).status,
    503,
    'API des comptes visiteurs ouverte à l’administrateur',
  )
  await payload.updateGlobal({ ...options, slug: 'site-settings', data: { maintenance: false } })
  assert.equal(
    (await readPublicSite(payload, 'en')).content.title,
    'Portrait de test français',
    'Fallback FR avant traduction',
  )
  const untranslated = await payload.findGlobal({
    slug: 'site-content',
    locale: 'en',
    fallbackLocale: false,
  })
  assert.ok(
    missingTranslations(
      'site-content',
      untranslated as unknown as Record<string, unknown>,
    ).includes('Titre'),
  )

  const initial = await fetch(`${origin}/`, { redirect: 'manual' })
  assert.equal(initial.status, 307)
  assert.equal(new URL(present(initial.headers.get('location')), origin).pathname, '/fr')
  const read = async (locale: string) => {
    const response = await fetch(`${origin}/${locale}`, {
      headers: { 'User-Agent': 'integration-test' },
    })
    assert.equal(response.status, 200)
    return response.text()
  }
  let fr = await read('fr')
  assert.match(fr, /<html lang="fr"/)
  assert.match(fr, /Portrait de test français/)
  let en = await read('en')
  assert.match(en, /<html lang="en"/)
  assert.match(en, /Portrait de test français/)
  assert.ok(en.includes(messages.en.discover))

  const buffer = await sharp({
    create: { width: 400, height: 500, channels: 3, background: '#ccc6b5' },
  })
    .png()
    .toBuffer()
  const image = await payload.create({
    ...options,
    collection: 'media',
    locale: 'fr',
    data: { alt: 'Image française de test' },
    file: {
      data: buffer,
      mimetype: 'image/png',
      name: 'public-integration.png',
      size: buffer.length,
    },
  })
  await payload.updateGlobal({
    ...options,
    slug: 'site-content',
    locale: 'en',
    data: {
      title: 'English test portrait',
      description: 'English description',
      heroImage: image.id,
    },
  })
  await payload.updateGlobal({
    ...options,
    slug: 'site-content',
    locale: 'fr',
    data: { title: 'Titre français actualisé', heroImage: image.id },
  })
  fr = await read('fr')
  en = await read('en')
  assert.match(fr, /Titre français actualisé/, 'Modification visible sans rebuild')
  assert.match(en, /English test portrait/)
  assert.match(en, /Image française de test/, 'Le texte alternatif utilise aussi le fallback FR')
  assert.ok(fr.includes(`/api/media/file/${image.filename}`))
  assert.equal((await fetch(`${origin}/api/media/file/${image.filename}`)).status, 200)
  assert.equal((await readPublicSite(payload, 'en')).content.seoTitle, 'SEO français')
  const sharing = await payload.create({
    ...options,
    collection: 'media',
    locale: 'fr',
    data: { alt: 'Image de partage' },
    file: {
      data: buffer,
      mimetype: 'image/png',
      name: 'sharing-integration.png',
      size: buffer.length,
    },
  })
  const readMetadata = async (path: string) => {
    const response = await fetch(origin + path, { headers: { 'User-Agent': 'Twitterbot' } })
    assert.equal(response.status, 200)
    return response.text()
  }
  const imageTag = (url: string) => `property="og:image" content="${url}"`
  const publicImage = `${origin}/api/media/file/${image.filename}`
  const sharingImage = `${origin}/api/media/file/${sharing.filename}`
  const fallback = await readMetadata('/en')
  assert.ok(fallback.includes('rel="icon" href="/site-icon.svg"'))
  assert.ok(fallback.includes(imageTag(publicImage)), 'Sharing falls back to the main image')
  assert.equal((await fetch(origin + '/site-icon.svg')).status, 200)
  await payload.updateGlobal({
    ...options,
    slug: 'site-content',
    locale: 'fr',
    data: { seoImage: sharing.id },
  })
  await payload.updateGlobal({
    ...options,
    slug: 'site-settings',
    data: { favicon: sharing.id },
  })
  const homePreview = await readMetadata('/fr')
  assert.ok(homePreview.includes(imageTag(sharingImage)))
  assert.match(homePreview, /<title>SEO français \| Atelier de test<\/title>/)
  assert.ok(homePreview.includes(`rel="icon" href="/api/media/file/${sharing.filename}"`))
  assert.ok(homePreview.includes(`rel="canonical" href="${origin}/fr"`))
  assert.equal((await fetch(`${origin}/de`)).status, 404)
  // Legal pages: placeholders from src/site, localized slugs, linked from every footer, crawl rules closed by default.
  for (const locale of ['fr', 'en'] as const)
    for (const key of ['legalNotice', 'terms', 'privacy'] as const) {
      const path = legalPath(locale, key)
      const response = await fetch(origin + path)
      assert.equal(response.status, 200, path)
      const html = await response.text()
      const placeholder = legalPlaceholders[locale][key]
      assert.ok(html.includes(`<h1>${placeholder.title}</h1>`), path)
      assert.ok(html.includes(placeholder.body[0] ?? ''), `${path}: placeholder text`)
      if (key === 'terms') assert.ok(html.includes('brouillon'), `${path}: version shown`)
      assert.match(
        html,
        /<meta name="robots" content="noindex, nofollow"/,
        `${path} reste non indexée sans PUBLIC_INDEXING`,
      )
    }
  assert.ok(
    fr.includes('href="/fr/mentions-legales"') && en.includes('href="/en/privacy"'),
    'Pied de page relié aux pages légales',
  )
  // A legal slug of the other language leads to the page in the URL's language.
  const otherLanguage = await fetch(`${origin}/en/mentions-legales`, { redirect: 'manual' })
  assert.equal(otherLanguage.status, 307)
  assert.equal(
    new URL(otherLanguage.headers.get('location') ?? '', origin).pathname,
    '/en/legal-notice',
  )
  // Unknown URLs get a real 404, rendered on the server inside the public layout
  // (global-not-found), not Next's error shell.
  for (const [path, text, lang] of [
    ['/fr/page-inexistante/sous-page', 'Cette page est introuvable', 'fr'],
    ['/en/unknown-page', 'Back to the homepage', 'en'],
  ] as const) {
    const response = await fetch(origin + path)
    assert.equal(response.status, 404, path)
    const html = await response.text()
    assert.ok(html.includes(text), path)
    assert.ok(html.includes(`<html lang="${lang}"`) && !html.includes('__next_error__'), path)
    assert.match(html, /<meta name="robots" content="noindex/, path)
  }
  const robots = await fetch(`${origin}/robots.txt`)
  assert.match(await robots.text(), /Disallow: \//)
  assert.equal(
    await (await fetch(`${origin}/sitemap.xml`)).text().then((xml) => xml.includes('<loc>')),
    false,
  )
  const headers = (await fetch(`${origin}/fr`)).headers
  assert.equal(headers.get('x-content-type-options'), 'nosniff')
  assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN')
  assert.equal(headers.get('x-powered-by'), null)
  // Production build: every script of the HTML pages carries this request's nonce (a page that
  // turned static would ship scripts without it, all blocked by the CSP), and no eval is allowed.
  for (const path of ['/fr', '/en/commande/acces', '/fr/mentions-legales', '/admin/login']) {
    const response = await fetch(origin + path)
    const policy = response.headers.get('content-security-policy') ?? ''
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
    assert.ok(nonce, `${path} : CSP avec nonce`)
    assert.ok(!policy.includes('unsafe-eval'), `${path} : pas d'eval en production`)
    const html = await response.text()
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag)
    assert.ok(scripts.length > 0, `${path} : scripts présents`)
    for (const tag of scripts)
      if (!tag.includes('type="application/ld+json"'))
        assert.ok(tag.includes(`nonce="${nonce}"`), `${path} : script sans nonce ${tag}`)
    // Audience measurement (site.config.json analytics): public pages only, allowed by their CSP.
    const host = site.analytics?.host
    const tracker = scripts.find((tag) => tag.includes('data-website-id=')) ?? ''
    if (!host || path.startsWith('/admin')) {
      assert.equal(tracker, '', `${path} : pas de mesure d’audience`)
      assert.ok(!/connect-src [^;]*https:/.test(policy), path)
      continue
    }
    assert.ok(tracker.includes(`src="${host}/script.js"`), path)
    assert.ok(tracker.includes(`data-website-id="${site.analytics?.websiteId ?? ''}"`), path)
    assert.ok(tracker.includes('defer') && tracker.includes('data-do-not-track="true"'), path)
    assert.ok(!tracker.includes('data-exclude-search'), `${path} : utm_* conservés`)
    assert.ok(policy.includes(`connect-src 'self' ${host}`), path)
  }
  assert.match(
    (await fetch(`${origin}/api/health`)).headers.get('content-security-policy') ?? '',
    /default-src 'none'.*sandbox/,
    'API : rien ne s’exécute dans une réponse servie depuis /api',
  )
  assert.equal(
    (await fetch(`${origin}/api/health`)).headers.get('x-robots-tag'),
    'noindex, nofollow',
  )
  assert.equal(
    (await fetch(`${origin}/fr/commande/acces`)).headers.get('referrer-policy'),
    'no-referrer',
  )
  const adminResponse = await fetch(`${origin}/admin/globals/site-content?locale=en`, {
    headers: { Cookie: adminCookie, Origin: origin },
  })
  const admin = await adminResponse.text()
  assert.equal(adminResponse.status, 200)
  assert.ok(
    admin.includes('Traductions enregistrées'),
    'Indicateur de traductions présent sur la page admin authentifiée',
  )
  assert.match(admin, /Titre SEO/)
  console.log(
    'Vérifications réussies : redirection, html lang, FR/EN, fallback, mise à jour sans rebuild, image publique, pages légales, 404, robots, en-têtes, maintenance et indicateur admin.',
  )
} finally {
  await payload.destroy()
}
