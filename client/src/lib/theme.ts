import { useSyncExternalStore } from 'react'

// Light/dark theme. The choice lives on <html data-theme="…"> (index.css keys every color
// variable off it) and is remembered in localStorage. With nothing saved it follows the OS
// setting. index.html runs the same read before React loads so the page never flashes the
// wrong theme.
export type Theme = 'light' | 'dark'

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

export function initTheme() {
  apply(readSaved() ?? systemTheme())
  // Keep following the OS until the user picks a theme themselves.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!readSaved()) apply(systemTheme())
  })
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Private mode etc.: the theme still switches for this page view.
  }
  apply(theme)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => 'light' as Theme)
  return { theme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}
