// DESIGN.md "Components > Status Badges": pill-shaped, 1px border of its semantic color,
// with a "glowing dot" to the left of the text. The dot pulses for live/active states.
// Semantic status colors per DESIGN.md "Colors": Emerald = safe/success, Amber = active/
// caution, Slate = complete/neutral, Error = alert — these map onto the success/warning/
// neutral/danger status tokens in index.css (overnight task: a real status-color system,
// not per-component ad hoc color). 'success' used to hardcode raw Tailwind
// emerald-500/700/50 instead of a token — the exact "default Tailwind color, not a
// deliberate one" problem this system replaces; 'active'/'neutral'/'error' already used real
// design tokens (primary-fixed/secondary/error-container), so their exact rendered color is
// left unchanged here — only 'success' actually needed fixing.
export type BadgeTone = 'success' | 'active' | 'neutral' | 'error'

const TONE_CLASSES: Record<BadgeTone, { pill: string; dot: string }> = {
  success: { pill: 'border-success text-on-success-container bg-success-container', dot: 'bg-success' },
  active: { pill: 'border-primary text-primary bg-primary-fixed', dot: 'bg-primary' }, // = warning role
  neutral: { pill: 'border-outline-variant text-secondary bg-surface-container-low', dot: 'bg-secondary' },
  error: { pill: 'border-error text-error bg-error-container', dot: 'bg-error' }, // = danger role
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
