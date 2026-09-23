// Refresh status color system (README "Status color system"). One set of tones used as pills
// everywhere:
//   success — checked in, confirmed trip, paid
//   caution — awaiting school confirm, owed
//   alert   — no-show, error
//   info    — parent skipped
//   neutral — not checked in, no rate set, ended
//   next    — the next stop
// The colors come from index.css, and switch for dark mode and for the mobile palette on
// their own.
export type BadgeTone = 'success' | 'caution' | 'alert' | 'info' | 'neutral' | 'next'

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success-fg',
  caution: 'bg-caution-bg text-caution-fg',
  alert: 'bg-alert-bg text-alert-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
  next: 'bg-next-bg text-next-fg',
}

// `mobile` pills are the driver/parent app's smaller square-ish tag with no dot.
export function StatusBadge({
  tone,
  label,
  mobile = false,
  className = '',
}: {
  tone: BadgeTone
  label: string
  mobile?: boolean
  className?: string
}) {
  if (mobile) {
    return (
      <span className={`inline-flex items-center rounded-[5px] px-[7px] py-0.5 text-[11px] font-medium whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}>
        {label}
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-[3px] text-[12px] font-semibold whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {label}
    </span>
  )
}
