import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { guidePath, guideSlugs, publishGuidePath } from '../src/core/i18n/guide'
import { locales } from '../src/core/i18n/locales'
import { guidePage, guidePages } from '../src/site/guide/load'
import { renderGuideMarkdown } from '../src/site/guide/render'
import { siteLinks } from '../src/site/SiteChrome'

const order = {
  fr: ['comment-ca-marche', 'publier-avec-github', 'publier-sans-github', 'format'],
  en: ['how-it-works', 'publish-with-github', 'publish-without-github', 'format'],
}

void test('the table of contents lists the four pages in order, in each language', () => {
  for (const locale of locales) {
    const pages = guidePages(locale)
    assert.deepEqual(
      pages.map((page) => page.slug),
      order[locale],
      locale,
    )
    for (const page of pages) {
      assert.ok(page.title.length > 3, `${locale}/${page.slug}: title`)
      assert.ok(page.summary.length > 20, `${locale}/${page.slug}: summary`)
    }
  }
})

void test('every page exists in French and in English, `other` naming its counterpart', () => {
  for (const [index, slug] of order.fr.entries()) {
    const fr = guidePage('fr', slug)
    const en = guidePage('en', order.en[index] ?? '')
    assert.ok(fr && en, slug)
    assert.equal(fr.other, order.en[index])
    assert.equal(en.other, slug)
    assert.ok(fr.html.length > 500 && en.html.length > 500, `${slug}: content`)
  }
})

void test('an unknown slug, or one of the other language, is no page', () => {
  assert.equal(guidePage('fr', 'inexistant'), null)
  assert.equal(guidePage('fr', 'how-it-works'), null)
  assert.equal(guidePage('en', 'comment-ca-marche'), null)
  assert.equal(guidePage('fr', '../../package'), null)
  assert.equal(guidePage('fr', ''), null)
})

void test('the guide addresses of the header, the decks module and the pages agree', () => {
  assert.deepEqual(
    guideSlugs.map((pair) => pair.fr),
    order.fr,
  )
  assert.deepEqual(
    guideSlugs.map((pair) => pair.en),
    order.en,
  )
  assert.equal(publishGuidePath('fr'), '/fr/guide/publier-avec-github')
  assert.equal(publishGuidePath('en'), '/en/guide/publish-with-github')
  for (const locale of locales) {
    assert.equal(siteLinks(locale).publish, publishGuidePath(locale))
    assert.equal(siteLinks(locale).guide, guidePath(locale))
    const slug = publishGuidePath(locale).split('/').pop() ?? ''
    assert.ok(guidePage(locale, slug), `${locale}: the publish page exists`)
  }
})

void test('raw HTML in Markdown comes out escaped, never as markup', () => {
  const { html } = renderGuideMarkdown(
    [
      '# Titre',
      '',
      '<script>alert(1)</script>',
      '',
      'Texte <img src=x onerror="alert(2)"> et <a href="javascript:alert(3)">lien</a>.',
      '',
      '[piège](javascript:alert(4))',
    ].join('\n'),
    'fr',
  )
  assert.ok(!/<script/i.test(html), html)
  assert.ok(!/<img[^>]*onerror/i.test(html), html)
  assert.ok(!/href="javascript:/i.test(html), html)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x onerror=/)
})

void test('rendering: title, anchored headings, links, callouts, code with Copy, images', () => {
  const { title, html } = renderGuideMarkdown(
    [
      '# Le titre',
      '',
      'Intro.',
      '',
      '## Créer un compte',
      '',
      '## Créer un compte',
      '',
      '[GitHub](https://github.com) et [le format](/fr/guide/format).',
      '',
      '> **Note**',
      '> À savoir.',
      '',
      '> **Attention**',
      '> Danger.',
      '',
      '> Une citation.',
      '',
      '```sh',
      'deckdock publish dist --hub https://<hub>',
      '```',
      '',
      '![Le bouton](/guide/bouton.png)',
      '',
      '![Ailleurs](https://example.com/x.png)',
    ].join('\n'),
    'fr',
  )
  assert.equal(title, 'Le titre')
  assert.ok(!html.includes('<h1'), 'the title is rendered by the page, not in the body')
  assert.match(html, /<h2 id="creer-un-compte"[^>]*>Créer un compte/)
  assert.match(html, /<h2 id="creer-un-compte-2"/)
  assert.match(html, /href="#creer-un-compte"/)
  assert.match(html, /<a href="https:\/\/github.com" rel="noopener noreferrer">GitHub<\/a>/)
  assert.match(html, /<a href="\/fr\/guide\/format">le format<\/a>/)
  assert.match(html, /class="callout callout-note"/)
  assert.match(html, /class="callout callout-warning"/)
  assert.match(html, /<blockquote>\s*<p>Une citation/)
  assert.match(
    html,
    /<pre><code class="language-sh">deckdock publish dist --hub https:\/\/&lt;hub&gt;/,
  )
  assert.match(
    html,
    /<button type="button" class="guide-copy" data-guide-copy hidden>Copier<\/button>/,
  )
  assert.match(html, /<img src="\/guide\/bouton.png" alt="Le bouton"/)
  assert.ok(!html.includes('https://example.com/x.png'), 'images come from public/guide/ only')
  assert.match(renderGuideMarkdown('```\nx\n```', 'en').html, />Copy<\/button>/)
})

void test('screenshot placeholders stay invisible', () => {
  const { html } = renderGuideMarkdown(
    '# T\n\nAvant.\n\n<!-- capture: le bouton « Use this template » -->\n\nAprès.',
    'fr',
  )
  assert.ok(!html.includes('capture'), html)
  assert.ok(!html.includes('&lt;!--'), html)
  assert.match(html, /Avant\.[\s\S]*Après\./)
})

const source = (locale: string, slug: string) =>
  readFileSync(`content/guide/${locale}/${slug}.md`, 'utf8')

void test('« Publier sans GitHub » shows deckdock publish and the curl request', () => {
  for (const [locale, slug] of [
    ['fr', 'publier-sans-github'],
    ['en', 'publish-without-github'],
  ] as const) {
    const html = guidePage(locale, slug)?.html ?? ''
    assert.match(html, /deckdock publish dist --hub/, locale)
    assert.match(html, /curl /, locale)
    assert.match(html, /POST \/api\/publish\/&lt;(édition|edition)&gt;/, locale)
    for (const status of ['published', 'pending_review', 'already_published', 'rejected'])
      assert.ok(html.includes(status), `${locale}: ${status}`)
  }
})

void test('« Publier avec GitHub » keeps marked screenshot placeholders, not rendered', () => {
  for (const [locale, slug] of [
    ['fr', 'publier-avec-github'],
    ['en', 'publish-with-github'],
  ] as const) {
    assert.ok((source(locale, slug).match(/<!-- capture: .+ -->/g) ?? []).length >= 3, locale)
    const html = guidePage(locale, slug)?.html ?? ''
    assert.ok(!html.includes('capture:'), locale)
    for (const word of ['Use this template', 'DECKDOCK_TOKEN', 'DECKDOCK_HUB_URL', 'Actions'])
      assert.ok(html.includes(word), `${locale}: ${word}`)
  }
})

void test('« Le format en détail » covers icon, homepage, editions, media and versions', () => {
  for (const locale of locales) {
    const html = guidePage(locale, 'format')?.html ?? ''
    for (const word of ['deckdock.yaml', 'icon', 'homepage', 'editions', 'media/'])
      assert.ok(html.includes(word), `${locale}: ${word}`)
  }
})

void test('the sitemap lists the guide, its home and every page in both languages', async () => {
  const previous = process.env['PUBLIC_INDEXING']
  process.env['PUBLIC_INDEXING'] = 'true'
  try {
    const { default: sitemap } = await import('../src/app/sitemap')
    const urls = sitemap().map((entry) => new URL(entry.url).pathname)
    for (const locale of locales) {
      assert.ok(urls.includes(guidePath(locale)), `${locale}: guide home`)
      for (const pair of guideSlugs)
        assert.ok(urls.includes(guidePath(locale, pair[locale])), `${locale}/${pair[locale]}`)
    }
  } finally {
    if (previous === undefined) delete process.env['PUBLIC_INDEXING']
    else process.env['PUBLIC_INDEXING'] = previous
  }
})
