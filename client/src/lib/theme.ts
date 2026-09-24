import { useSyncExternalStore } from 'react'

// Light/dark theme. The applied theme lives on <html data-theme="…"> (index.css keys every color
// variable off it). The user's preference is System (follow the OS), Light or Dark, remembered in
// localStorage; nothing saved means System. index.html runs the same read before React loads so
// the page never flashes the wrong theme (it treats anything but light/dark as System).
export type Theme = 'light' | 'dark'
export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_KEY = 'saferoute-theme'

function readSaved(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'light' || v === 'dark' ? v : null
  } catch {
    return null
  }
}

function systemTheme(): Theme {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function current(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'dark' ? 'dark' : 'light'
}

const listeners = new Set<() => void>()

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme)
  listeners.forEach((l) => l())
}

function readPreference(): ThemePreference {
  return readSaved() ?? 'system'
}

export function initTheme() {
  apply(readSaved() ?? systemTheme())
  // Keep following the OS until the user picks a theme themselves.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!readSaved()) apply(systemTheme())
  })
}

export function setThemePreference(pref: ThemePreference) {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // Private mode etc.: the theme still switches for this page view.
  }
  apply(pref === 'system' ? systemTheme() : pref)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const NEXT: Record<ThemePreference, ThemePreference> = { system: 'light', light: 'dark', dark: 'system' }

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as Theme)
  const preference = useSyncExternalStore(subscribe, readPreference, () => 'system' as ThemePreference)
  return {
    theme,
    preference,
    setPreference: setThemePreference,
    // The header/sidebar button: System → Light → Dark → System.
    cycle: () => setThemePreference(NEXT[preference]),
    next: NEXT[preference],
  }
}
