import { useSyncExternalStore } from 'react'

// Tailwind's breakpoints, for the few layouts that render different markup (not just different
// classes) at wider screens: the driver/parent website shell from md, side-by-side panels from lg.
export const MD_QUERY = '(min-width: 768px)'
export const LG_QUERY = '(min-width: 1024px)'

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
