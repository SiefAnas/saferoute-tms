import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useColorScheme } from 'react-native'
import { dark, light, type Palette } from './tokens'

// The theme follows the phone's own light/dark setting (the brief's requirement), so there is
// no in-app toggle and nothing to persist. The design's toggle button belongs to the web app,
// where there is no OS signal to follow.
interface ThemeValue {
  colors: Palette
  isDark: boolean
}

const ThemeContext = createContext<ThemeValue>({ colors: light, isDark: false })

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme()
  const isDark = scheme === 'dark'
  const value = useMemo(() => ({ colors: isDark ? dark : light, isDark }), [isDark])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext)
}

export function useColors(): Palette {
  return useContext(ThemeContext).colors
}
