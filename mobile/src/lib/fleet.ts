import { isAssignmentActiveToday } from './format'
import type { Assignment, Van } from '@/api/types'

// A driver's current assignment: the most recently created one active today. Display-only
// (it decides which van to show in the header), the same rule the web app uses.
export function currentAssignmentBy(
  assignments: Assignment[],
  key: 'driver_user_id' | 'student_id' | 'van_id',
): Map<string, Assignment> {
  const map = new Map<string, Assignment>()
  for (const a of assignments) {
    if (!isAssignmentActiveToday(a.start_date, a.end_date)) continue
    const k = a[key]
    const existing = map.get(k)
    if (!existing || a.created_at > existing.created_at) map.set(k, a)
  }
  return map
}

type VanLike = Pick<Van, 'brand' | 'model' | 'license_plate'> & { number?: string | null }

// "Van 04" when the van has a fleet number, otherwise "Ford Transit".
export function vanName(v: VanLike): string {
  return v.number ? `Van ${v.number}` : `${v.brand} ${v.model}`
}

// "Van 04 · KX-4471" or "Ford Transit · KX-4471".
export function vanLabel(v: VanLike | null | undefined): string {
  if (!v) return 'No van'
  return `${vanName(v)} · ${v.license_plate}`
}
