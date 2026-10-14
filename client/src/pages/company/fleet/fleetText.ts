import type { BadgeTone } from '../../../components/StatusBadge'
import type { MaintenanceItem } from '../../../types/api'

// Display helpers for the fleet maintenance screens (pure, no React).
export const miles = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString()} mi`)

export function shortDate(iso: string | null) {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// "Due in 12 days", "400 mi to go", "3 days overdue", "Set a date"...
export function dueLine(i: MaintenanceItem): string {
  switch (i.state) {
    case 'off':
      return 'Turned off'
    case 'not_set':
      return i.schedule_type === 'date' ? 'No due date set' : 'No mileage target set'
    case 'no_reading':
      return `Due at ${miles(i.due_miles)} · no odometer reading yet`
  }
  if (i.schedule_type === 'date') {
    const d = i.days_left ?? 0
    if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue (${shortDate(i.due_date)})`
    return d === 0 ? `Due today (${shortDate(i.due_date)})` : `Due in ${d} day${d === 1 ? '' : 's'} (${shortDate(i.due_date)})`
  }
  const m = i.miles_left ?? 0
  if (m < 0) return `${(-m).toLocaleString()} mi over (due at ${miles(i.due_miles)})`
  return `${m.toLocaleString()} mi to go (at ${miles(i.due_miles)})`
}

export function stateBadge(i: MaintenanceItem): { tone: BadgeTone; label: string } | null {
  if (i.state === 'overdue') return { tone: 'alert', label: 'Overdue' }
  if (i.state === 'due_soon') return { tone: 'caution', label: 'Due soon' }
  if (i.state === 'ok') return { tone: 'success', label: 'OK' }
  if (i.state === 'off') return { tone: 'neutral', label: 'Off' }
  return null
}

// The odometer reminder choices (days; null = off).
export const ODOMETER_CHOICES: { value: number | null; label: string }[] = [
  { value: null, label: 'Off' },
  { value: 7, label: 'Every week' },
  { value: 14, label: 'Every 2 weeks' },
  { value: 30, label: 'Every month' },
]
