'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react'
import {
  SYSTEM_DARK_QUERY,
  THEME_STORAGE_KEY,
  applyTheme,
  parsePreference,
  resolveTheme,
  type ThemePreference,
} from './preference'

export interface ThemeToggleLabels {
  /** Start of the accessible name with its punctuation, e.g. « Thème : » or "Theme:". */
  change: string
  system: string
  light: string
  dark: string
}

const next: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}
const icons = { system: MonitorIcon, light: SunIcon, dark: MoonIcon }

/**
 * The preference lives in localStorage, read as an external store. Storage can throw (private
 * browsing, blocked site data) or refuse writes only (full quota): the choice then lasts for the
 * page, in `memory`, which wins over storage from the first failed write.
 */
let memory: ThemePreference = 'system'
let unwritable = false
const listeners = new Set<() => void>()

function readPreference(): ThemePreference {
  if (unwritable) return memory
  try {
    return parsePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return memory
  }
}
function choose(preference: ThemePreference) {
  memory = preference
  try {
    if (preference === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY)
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Not remembered; the page still changes.
    unwritable = true
  }
  for (const listener of listeners) listener()
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab changed the choice.
  window.addEventListener('storage', listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', listener)
  }
}

const usePreference = () => useSyncExternalStore(subscribe, readPreference, () => 'system' as const)

/**
 * Keeps <html> on the preferred theme: after a choice, when the system theme changes in « system »
 * mode, and on pages where the boot script never ran (an unknown URL is answered with Next's
 * error shell and rendered in the browser, where an inserted script does not execute). In the
 * public layout, on every page.
 */
export function ThemeSync() {
  const preference = usePreference()
  useEffect(() => {
    const media = window.matchMedia(SYSTEM_DARK_QUERY)
    const apply = () => {
      applyTheme(document.documentElement, resolveTheme(preference, media.matches))
    }
    apply()
    if (preference !== 'system') return
    media.addEventListener('change', apply)
    return () => {
      media.removeEventListener('change', apply)
    }
  }, [preference])
  return null
}

/**
 * The public site's theme button: system → light → dark → system. The server renders « system »;
 * the stored preference is read after hydration. ThemeSync applies the choice.
 */
export function ThemeToggle({ labels }: { labels: ThemeToggleLabels }) {
  const preference = usePreference()
  const Icon = icons[preference]
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`${labels.change} ${labels[preference]}`}
      title={`${labels.change} ${labels[preference]}`}
      onClick={() => {
        choose(next[preference])
      }}
    >
      <Icon aria-hidden="true" size={18} />
    </button>
  )
}
