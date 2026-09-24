import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { dark, light, type Palette } from './tokens'

// Light/dark theme. The user picks System (follow the phone), Light or Dark; the choice is saved
// on the device (expo-secure-store, the only storage the app ships; the value isn't secret) and
// restored on the next start. Until it has loaded, System is used.
export type ThemePreference = 'system' | 'light' | 'dark'

const PREF_KEY = 'saferoute_theme'

interface ThemeValue {
  colors: Palette
  isDark: boolean
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
}

const ThemeContext = createContext<ThemeValue>({ colors: light, isDark: false, preference: 'system', setPreference: () => {} })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme()
  const [preference, setPref] = useState<ThemePreference>('system')

  useEffect(() => {
    SecureStore.getItemAsync(PREF_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPref(v)
      })
      .catch(() => {})
  }, [])

  const setPreference = useCallback((p: ThemePreference) => {
    setPref(p)
    SecureStore.setItemAsync(PREF_KEY, p).catch(() => {})
  }, [])

  const isDark = preference === 'system' ? scheme === 'dark' : preference === 'dark'
  const value = useMemo(() => ({ colors: isDark ? dark : light, isDark, preference, setPreference }), [isDark, preference, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext)
}

export function useColors(): Palette {
  return useContext(ThemeContext).colors
}

// Order the header button cycles through, with its icon and spoken label.
export const THEME_CYCLE: Record<ThemePreference, { next: ThemePreference; icon: 'brightness-auto' | 'light-mode' | 'dark-mode'; label: string }> = {
  system: { next: 'light', icon: 'brightness-auto', label: 'System' },
  light: { next: 'dark', icon: 'light-mode', label: 'Light' },
  dark: { next: 'system', icon: 'dark-mode', label: 'Dark' },
}
