import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const css = readFileSync('src/styles/theme.css', 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`. */
function block(selector: string): Map<string, string> {
  const start = css.search(new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{`))
  assert.ok(start >= 0, `${selector} rule in theme.css`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const declarations = new Map<string, string>()
  for (const match of body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1] ?? '', (match[2] ?? '').trim())
  }
  return declarations
}

const light = block(':root')
const dark = new Map([...light, ...block('.dark')])
const hasColor = (value: string) => /#[0-9a-f]{3,8}\b/i.test(value)

function resolve(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(`--${name}`)
  assert.ok(value, `--${name} defined`)
  const alias = /^var\((--[\w-]+)\)$/.exec(value)
  return alias ? resolve(tokens, (alias[1] ?? '').slice(2)) : value
}

function luminance(hex: string): number {
  const digits = hex.replace('#', '')
  const full = digits.length === 3 ? digits.replace(/./g, '$&$&') : digits.slice(0, 6)
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}
function contrast(tokens: Map<string, string>, front: string, back: string): number {
  const [a, b] = [luminance(resolve(tokens, front)), luminance(resolve(tokens, back))]
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const textPairs = [
  ['foreground', 'background'],
  ['muted-foreground', 'background'],
  ['card-foreground', 'card'],
  ['muted-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'muted'],
  ['accent-foreground', 'accent'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  ['brand', 'background'],
  ['brand', 'card'],
  // The homepage: its badge and step numbers, its lead on the hero's tinted top, the code excerpt.
  ['brand', 'accent'],
  ['muted-foreground', 'secondary'],
  ['code-foreground', 'code'],
  // Status pills: « Publié » (brand on secondary), « Masqué » (destructive on muted); the active
  // entry of the author space's sidebar (brand on secondary).
  ['brand', 'secondary'],
  ['destructive', 'muted'],
  // The initial of a deck without an icon: white on each of the 8 stable colours.
  ...Array.from({ length: 8 }, (_, i) => ['initial-foreground', `initial-${i + 1}`]),
]
/** Large text (WCAG 1.4.3, 3:1): both ends of the homepage title's gradient, on the hero's tinted
 *  top and on the page. */
const largeTextPairs = [
  ['gradient-from', 'secondary'],
  ['gradient-to', 'secondary'],
  ['gradient-from', 'background'],
  ['gradient-to', 'background'],
] as const
/** Non-text contrast (WCAG 1.4.11): the focus ring, field borders and strong borders need 3:1
 *  against the page in both themes. */
const nonTextPairs = [
  ['ring', 'background'],
  ['input', 'background'],
  ['input', 'card'],
  ['border-strong', 'background'],
] as const

/** The DeckDock palette (spec 2026-11-26-refonte-ux). `brand` is the indigo accent used as text:
 *  #6366f1 is only 4.28:1 on the dark background, so dark text uses its lighter tint. `primary` is the
 *  button fill: the dark one is nudged from #6366f1 (white on it is 4.47:1) to pass AA with white. */
const expected = {
  light: {
    primary: '#4f46e5',
    background: '#fbfaff',
    brand: '#4f46e5',
    'gradient-from': '#4f46e5',
    'gradient-to': '#db2777',
  },
  dark: {
    ring: '#6366f1',
    background: '#0f0e1a',
    'gradient-from': '#818cf8',
    'gradient-to': '#f472b6',
  },
} as const

void test('the palette is the DeckDock one', () => {
  for (const [name, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const [token, value] of Object.entries(expected[name])) {
      assert.equal(resolve(tokens, token).toLowerCase(), value, `${name} --${token}`)
    }
    assert.ok(tokens.get('--shadow-card'), `${name} --shadow-card`)
  }
  assert.match(css, /--radius:\s*0\.875rem/)
  assert.ok(!/@import|url\(/.test(css), 'no external font or asset in theme.css')
})

void test('every colour token of :root has its own value in .dark', () => {
  const darkOwn = block('.dark')
  const missing = [...light].filter(([, value]) => hasColor(value)).map(([name]) => name)
  assert.deepEqual(
    missing.filter((name) => !darkOwn.has(name)),
    [],
  )
  assert.match(css, /\.dark\s*\{[^}]*color-scheme:\s*dark/)
})

void test('AA contrast in the light and the dark theme', () => {
  for (const [name, tokens] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    for (const [front = '', back = ''] of textPairs) {
      const ratio = contrast(tokens, front, back)
      assert.ok(ratio >= 4.5, `${name}: ${front} on ${back} is ${ratio.toFixed(2)}:1, below 4.5:1`)
    }
    for (const [front, back] of largeTextPairs) {
      const ratio = contrast(tokens, front, back)
      assert.ok(ratio >= 3, `${name}: ${front} on ${back} is ${ratio.toFixed(2)}:1, below 3:1`)
    }
    for (const [front, back] of nonTextPairs) {
      const ratio = contrast(tokens, front, back)
      assert.ok(ratio >= 3, `${name}: ${front} on ${back} is ${ratio.toFixed(2)}:1, below 3:1`)
    }
  }
})

/** Public styles and components; emails and the admin keep their own fixed colours. */
const publicSources = [
  'src/styles',
  'src/site',
  'src/core/ui',
  'src/app/(frontend)',
  ...readdirSync('src/modules').map((name) => join('src/modules', name, 'ui')),
]
function files(path: string): string[] {
  try {
    if (statSync(path).isFile()) return [path]
  } catch {
    return []
  }
  return readdirSync(path).flatMap((entry) => files(join(path, entry)))
}

/**
 * Fixed colours that are meant to stay the same in both themes. The card preview iframe (PreviewCarousel)
 * frames a sandboxed card document whose own CSS comes from the deck and assumes a white page: its
 * background must not follow the site theme.
 */
const allowed = [
  {
    file: 'src/modules/decks/ui/PreviewCarousel.tsx',
    text: 'className="h-56 w-full rounded-lg bg-white"',
  },
]

void test('no literal colour in public styles and components outside theme.css', () => {
  const offenders = publicSources
    .flatMap(files)
    .filter((file) => /\.(css|tsx?)$/.test(file) && !file.endsWith('theme.css'))
    .flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ file, line: index + 1, text: line }))
        .filter(({ file, text }) => !allowed.some((a) => a.file === file && text.includes(a.text)))
        .filter(({ text }) =>
          /#[0-9a-f]{3,8}\b(?![\w-])|\brgba?\(|\b(?:bg|text|border)-(?:white|black)\b/i.test(text),
        )
        .map(({ file, line }) => `${file}:${line}`),
    )
  assert.deepEqual(offenders, [])
})
