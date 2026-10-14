import type { MaintenanceItem } from '@/api/types'
import type { ToneName } from '@/theme/tokens'

// Display helpers for maintenance (pure; same wording as the website's fleetText.ts).
export const milesText = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${n.toLocaleString('en-US')} mi`)

export function shortDate(iso: string | null): string {
  if (!iso) return '—'
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function dueLine(i: MaintenanceItem): string {
  if (i.state === 'off') return 'Turned off'
  if (i.state === 'not_set') return i.schedule_type === 'date' ? 'No due date set' : 'No mileage target set'
  if (i.state === 'no_reading') return `Due at ${milesText(i.due_miles)} · no odometer reading yet`
  if (i.schedule_type === 'date') {
    const d = i.days_left ?? 0
    if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue (${shortDate(i.due_date)})`
    return d === 0 ? `Due today (${shortDate(i.due_date)})` : `Due in ${d} day${d === 1 ? '' : 's'} (${shortDate(i.due_date)})`
  }
  const m = i.miles_left ?? 0
  if (m < 0) return `${(-m).toLocaleString('en-US')} mi over (due at ${milesText(i.due_miles)})`
  return `${m.toLocaleString('en-US')} mi to go (at ${milesText(i.due_miles)})`
}

export function stateBadge(i: MaintenanceItem): { label: string; tone: ToneName } | null {
  if (i.state === 'overdue') return { label: 'Overdue', tone: 'alert' }
  if (i.state === 'due_soon') return { label: 'Due soon', tone: 'caution' }
  if (i.state === 'ok') return { label: 'OK', tone: 'success' }
  if (i.state === 'off') return { label: 'Off', tone: 'neutral' }
  return null
}

// The fuel form: miles required (whole number), gallons and cost optional numbers.
export function fuelBody(miles: string, gallons: string, cost: string): { ok: true; body: Record<string, number | null> } | { ok: false; error: string } {
  const m = Number(miles.trim())
  if (!miles.trim() || !Number.isInteger(m) || m < 0) return { ok: false, error: 'Enter the odometer miles (a whole number).' }
  const opt = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')))
  const g = opt(gallons)
  const c = opt(cost)
  if (g !== null && (!Number.isFinite(g) || g <= 0)) return { ok: false, error: 'Gallons must be a number above 0.' }
  if (c !== null && (!Number.isFinite(c) || c < 0)) return { ok: false, error: 'Cost must be an amount in dollars.' }
  return { ok: true, body: { miles: m, gallons: g, cost: c } }
}
