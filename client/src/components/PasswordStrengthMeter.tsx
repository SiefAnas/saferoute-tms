interface PasswordStrengthMeterProps {
  password: string
}

// Live UX hint only — actual enforcement is the required-rules checklist shown alongside
// this, plus the backend's own assertPasswordStrength. Score counts length/variety signals
// beyond the bare minimum so two passwords that both pass validation still visibly differ.
function scorePassword(password: string): number {
  if (!password) return 0
  let score = 0
  if (password.length >= 8) score += 1
  if (password.length >= 12) score += 1
  if (/[A-Z]/.test(password)) score += 1
  if (/[a-z]/.test(password)) score += 1
  if (/[0-9]/.test(password)) score += 1
  if (/[^A-Za-z0-9]/.test(password)) score += 1
  return score
}

const LEVELS = [
  { max: 2, label: 'Weak', color: 'bg-error' },
  { max: 4, label: 'Fair', color: 'bg-amber-500' },
  { max: 6, label: 'Good', color: 'bg-green-600' },
]

export function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  if (!password) return null
  const score = scorePassword(password)
  const level = LEVELS.find((l) => score <= l.max) ?? LEVELS[LEVELS.length - 1]
  const pct = Math.round((score / 6) * 100)

  return (
    <div className="flex flex-col gap-1">
      <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container">
        <div className={`h-full rounded-full transition-all ${level.color}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-label-md text-on-surface-variant">Password strength: {level.label}</p>
    </div>
  )
}
