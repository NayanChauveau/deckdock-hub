import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import {
  THEME_STORAGE_KEY,
  parsePreference,
  resolveTheme,
  themeBootScript,
} from '../src/core/ui/theme/preference'

void test('parsePreference: only light and dark are explicit choices', () => {
  assert.equal(parsePreference('dark'), 'dark')
  assert.equal(parsePreference('light'), 'light')
  for (const value of [null, undefined, '', 'blue', 'DARK']) {
    assert.equal(parsePreference(value), 'system')
  }
})

void test('resolveTheme: an explicit choice wins, otherwise the system', () => {
  assert.equal(resolveTheme('system', true), 'dark')
  assert.equal(resolveTheme('system', false), 'light')
  assert.equal(resolveTheme('light', true), 'light')
  assert.equal(resolveTheme('dark', false), 'dark')
})

/** Runs the boot script against a fake document, storage and media query; returns the root. */
function boot(stored: string | null, systemDark: boolean, storageThrows = false) {
  const classes = new Set<string>()
  const root = {
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, force?: boolean) => {
        const on = force ?? !classes.has(name)
        if (on) classes.add(name)
        else classes.delete(name)
        return on
      },
      contains: (name: string) => classes.has(name),
    },
    style: { colorScheme: '' },
  }
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error('SecurityError')
      return key === THEME_STORAGE_KEY ? stored : null
    },
  }
  runInNewContext(themeBootScript(), {
    document: { documentElement: root },
    localStorage,
    window: {
      get localStorage() {
        return localStorage
      },
      matchMedia: (query: string) => ({
        matches: query === '(prefers-color-scheme: dark)' && systemDark,
      }),
    },
  })
  return { dark: classes.has('dark'), colorScheme: root.style.colorScheme }
}

void test('themeBootScript: applies the theme before rendering', () => {
  assert.deepEqual(boot('dark', false), { dark: true, colorScheme: 'dark' })
  assert.deepEqual(boot(null, true), { dark: true, colorScheme: 'dark' })
  assert.deepEqual(boot('light', true), { dark: false, colorScheme: 'light' })
  assert.deepEqual(boot(null, false), { dark: false, colorScheme: 'light' })
})

void test('themeBootScript: storage that throws follows the system, without an error', () => {
  assert.deepEqual(boot(null, true, true), { dark: true, colorScheme: 'dark' })
  assert.deepEqual(boot('dark', false, true), { dark: false, colorScheme: 'light' })
})

void test('themeBootScript: an invalid stored value follows the system', () => {
  assert.deepEqual(boot('blue', true), { dark: true, colorScheme: 'dark' })
  assert.deepEqual(boot('', false), { dark: false, colorScheme: 'light' })
})
