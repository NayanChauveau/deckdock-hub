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
  ['primary-foreground', 'primary'],
  ['muted-foreground', 'muted'],
  ['destructive', 'background'],
  ['brand', 'background'],
  ['art-signature', 'art-paper'],
]
/** The focus ring needs 3:1. Field and strong borders are below 3:1 in the (unchanged) light theme,
 *  so the dark theme must simply not be worse than the light one. */
const focusPair = ['ring', 'background'] as const
const borderPairs = [
  ['input', 'background'],
  ['border-strong', 'background'],
]

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
    const focus = contrast(tokens, ...focusPair)
    assert.ok(focus >= 3, `${name}: ring on background is ${focus.toFixed(2)}:1, below 3:1`)
  }
  for (const [front = '', back = ''] of borderPairs) {
    const [ofLight, ofDark] = [contrast(light, front, back), contrast(dark, front, back)]
    assert.ok(
      ofDark >= ofLight,
      `dark ${front} on ${back} (${ofDark.toFixed(2)}:1) is worse than light (${ofLight.toFixed(2)}:1)`,
    )
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
 * Fixed colours that are meant to stay the same in both themes. The card preview iframe (DeckPage)
 * frames a sandboxed card document whose own CSS comes from the deck and assumes a white page: its
 * background must not follow the site theme.
 */
const allowed = [
  { file: 'src/modules/decks/ui/DeckPage.tsx', text: 'rounded-lg border border-border bg-white' },
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
