import './support/dom'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react/pure'
import { ThemeSync, ThemeToggle } from '../src/core/ui/theme/ThemeToggle'
import type * as ThemeToggleModule from '../src/core/ui/theme/ThemeToggle'
import { THEME_STORAGE_KEY } from '../src/core/ui/theme/preference'

const labels = { change: 'Thème :', system: 'système', light: 'clair', dark: 'sombre' }
const root = () => document.documentElement

/** A controllable `prefers-color-scheme: dark` media query on the jsdom window. */
let systemDark = false
let listeners: (() => void)[] = []
function setSystem(dark: boolean) {
  systemDark = dark
  for (const listener of listeners) listener()
}

beforeEach(() => {
  systemDark = false
  listeners = []
  window.localStorage.clear()
  root().classList.remove('dark')
  root().style.colorScheme = ''
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: () => ({
      get matches() {
        return systemDark
      },
      addEventListener: (_: string, listener: () => void) => listeners.push(listener),
      removeEventListener: (_: string, listener: () => void) => {
        listeners = listeners.filter((other) => other !== listener)
      },
    }),
  })
})
afterEach(cleanup)

/** A fresh copy of the module: broken-storage cases leave page-lifetime state behind them. */
let copies = 0
const freshModule = () =>
  import(`../src/core/ui/theme/ThemeToggle.tsx?copy=${++copies}`) as Promise<
    typeof ThemeToggleModule
  >

void test('ThemeSync alone applies the stored theme, for pages the boot script did not run on', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
  render(<ThemeSync />)
  assert.equal(root().classList.contains('dark'), true)
  assert.equal(root().style.colorScheme, 'dark')
})

void test('ThemeSync alone follows the system when nothing is stored', () => {
  render(<ThemeSync />)
  setSystem(true)
  assert.equal(root().classList.contains('dark'), true)
})

void test('the button cycles system, light, dark and remembers the choice', () => {
  render(
    <>
      <ThemeSync />
      <ThemeToggle labels={labels} />
    </>,
  )
  const button = screen.getByRole('button', { name: 'Thème : système' })
  fireEvent.click(button)
  assert.equal(window.localStorage.getItem(THEME_STORAGE_KEY), 'light')
  assert.equal(root().classList.contains('dark'), false)
  assert.equal(root().style.colorScheme, 'light')
  fireEvent.click(button)
  assert.equal(window.localStorage.getItem(THEME_STORAGE_KEY), 'dark')
  assert.equal(root().classList.contains('dark'), true)
  fireEvent.click(button)
  assert.equal(window.localStorage.getItem(THEME_STORAGE_KEY), null)
  assert.equal(root().classList.contains('dark'), false)
})

void test('it starts from the stored choice', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
  render(
    <>
      <ThemeSync />
      <ThemeToggle labels={labels} />
    </>,
  )
  assert.ok(screen.getByRole('button', { name: 'Thème : sombre' }))
})

void test('in system mode, a change of the system theme applies at once', () => {
  render(
    <>
      <ThemeSync />
      <ThemeToggle labels={labels} />
    </>,
  )
  setSystem(true)
  assert.equal(root().classList.contains('dark'), true)
  setSystem(false)
  assert.equal(root().classList.contains('dark'), false)
})

void test('with an explicit choice, a change of the system theme is ignored', () => {
  window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
  render(
    <>
      <ThemeSync />
      <ThemeToggle labels={labels} />
    </>,
  )
  setSystem(true)
  assert.equal(root().classList.contains('dark'), false)
})

void test('storage that throws: the button still changes the page theme', async () => {
  const fresh = await freshModule()
  const storage = window.localStorage
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError')
    },
  })
  try {
    render(
      <>
        <fresh.ThemeSync />
        <fresh.ThemeToggle labels={labels} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Thème : système' }))
    fireEvent.click(screen.getByRole('button', { name: 'Thème : clair' }))
    assert.equal(root().classList.contains('dark'), true)
    assert.ok(screen.getByRole('button', { name: 'Thème : sombre' }))
  } finally {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
  }
})

void test('storage that reads but cannot write (quota full): the button still changes the theme', async () => {
  const fresh = await freshModule()
  window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
  const storage = window.localStorage
  const readOnly = {
    getItem: (key: string) => storage.getItem(key),
    setItem: () => {
      throw new Error('QuotaExceededError')
    },
    removeItem: () => {
      throw new Error('QuotaExceededError')
    },
  }
  Object.defineProperty(window, 'localStorage', { configurable: true, value: readOnly })
  try {
    render(
      <>
        <fresh.ThemeSync />
        <fresh.ThemeToggle labels={labels} />
      </>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Thème : clair' }))
    assert.equal(root().classList.contains('dark'), true)
    assert.ok(screen.getByRole('button', { name: 'Thème : sombre' }))
  } finally {
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage })
  }
})
