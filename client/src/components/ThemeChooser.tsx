import { useTheme, type ThemePreference } from '../lib/theme'

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// "Appearance": System / Light / Dark as a segmented control (saved in this browser).
export function ThemeChooser() {
  const { preference, setPreference } = useTheme()
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-muted">Appearance</span>
      <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-[3px] rounded-m bg-seg-track p-[3px]">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={preference === o.value}
            onClick={() => setPreference(o.value)}
            className={`h-[38px] cursor-pointer rounded-row text-[14px] font-medium ${
              preference === o.value ? 'bg-seg-on text-ink shadow-seg' : 'text-muted'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
