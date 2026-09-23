import { useTheme } from '../lib/theme'

// Web: a 32px slate square in the sidebar footer. Mobile: a 38px round button in the greeting
// header (README "Theming").
export function ThemeToggle({ variant }: { variant: 'sidebar' | 'mobile' }) {
  const { theme, toggle } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  const icon = theme === 'dark' ? 'light_mode' : 'dark_mode'
  const label = `Switch to ${next} mode`

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-row bg-sidebar-chip text-white hover:opacity-85"
      >
        <span className="material-symbols-outlined !text-[18px]">{icon}</span>
      </button>
    )
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-full border border-line bg-surface text-ink"
    >
      <span className="material-symbols-outlined !text-[20px]">{icon}</span>
    </button>
  )
}
