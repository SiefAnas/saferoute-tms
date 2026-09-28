// SafeTurns logo colors (design-reference/brand/safeturns-logo/CC_PROMPT.md table). Light theme
// = amber, dark theme = evergreen; then "on-light" / "on-dark" by what is behind the logo, and
// "auto" = a surface that flips with the theme (on-light in light, on-dark in dark).
export type LogoPart = 'shield' | 'arrow' | 'safe' | 'turns'
export type LogoSurface = 'light' | 'dark' | 'auto'

const COLORS: Record<'amber' | 'evergreen', Record<'light' | 'dark', Record<LogoPart, string>>> = {
  amber: {
    light: { shield: '#111318', arrow: '#F59E0B', safe: '#111318', turns: '#B86E00' },
    dark: { shield: '#F59E0B', arrow: '#111318', safe: '#FAF8F3', turns: '#F59E0B' },
  },
  evergreen: {
    light: { shield: '#123C36', arrow: '#F5F0E6', safe: '#123C36', turns: '#23876A' },
    dark: { shield: '#F5F0E6', arrow: '#123C36', safe: '#F5F0E6', turns: '#8FD9B8' },
  },
}

export function logoColors(isDark: boolean, surface: LogoSurface): Record<LogoPart, string> {
  const onSurface = surface === 'auto' ? (isDark ? 'dark' : 'light') : surface
  return COLORS[isDark ? 'evergreen' : 'amber'][onSurface]
}
