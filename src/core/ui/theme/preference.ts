/**
 * Light or dark theme of the public site. The visitor's explicit choice is kept in localStorage;
 * without one, the site follows the system (`prefers-color-scheme`). The theme is the `dark` class on
 * <html> (the variant shadcn's primitives use) plus `color-scheme` for native controls.
 */
export type ThemeChoice = 'light' | 'dark'
export type ThemePreference = ThemeChoice | 'system'

export const THEME_STORAGE_KEY = 'site-theme'
export const SYSTEM_DARK_QUERY = '(prefers-color-scheme: dark)'

export function parsePreference(stored: string | null | undefined): ThemePreference {
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ThemeChoice {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

export function applyTheme(root: HTMLElement, theme: ThemeChoice): void {
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

/**
 * Source of the inline script run in <head> before the first paint, so a dark page never flashes
 * white. It is self-contained (no import) and repeats parsePreference, resolveTheme and applyTheme;
 * tests/theme.test.ts runs it against the same cases. Storage can throw (private browsing, blocked
 * site data): the system preference applies then.
 */
export function themeBootScript(): string {
  const key = JSON.stringify(THEME_STORAGE_KEY)
  const query = JSON.stringify(SYSTEM_DARK_QUERY)
  return `(function(){var s=null;try{s=window.localStorage.getItem(${key})}catch(e){}var d=s==='dark'||(s!=='light'&&window.matchMedia(${query}).matches);var r=document.documentElement;r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light'})()`
}
