// DESIGN.md "Components > Status Badges": pill-shaped, 1px border of its semantic color,
// with a "glowing dot" to the left of the text. The dot pulses for live/active states.
// Semantic status colors per DESIGN.md "Colors": Emerald = safe/success, Amber = active/
// caution, Slate = complete/neutral, Error = alert.
export type BadgeTone = 'success' | 'active' | 'neutral' | 'error'

const TONE_CLASSES: Record<BadgeTone, { pill: string; dot: string }> = {
  success: { pill: 'border-emerald-500 text-emerald-700 bg-emerald-50', dot: 'bg-emerald-500' },
  active: { pill: 'border-primary text-primary bg-primary-fixed', dot: 'bg-primary' },
  neutral: { pill: 'border-outline-variant text-secondary bg-surface-container-low', dot: 'bg-secondary' },
  error: { pill: 'border-error text-error bg-error-container', dot: 'bg-error' },
}

export function StatusBadge({ tone, label, pulse = false }: { tone: BadgeTone; label: string; pulse?: boolean }) {
  const cfg = TONE_CLASSES[tone]
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-label-md ${cfg.pill}`}>
      <span className={`h-2 w-2 rounded-full ${cfg.dot} ${pulse ? 'animate-pulse' : ''}`} />
      {label}
    </span>
  )
}
