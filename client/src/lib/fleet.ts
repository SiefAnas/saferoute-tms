import { isAssignmentActiveToday } from './format'
import type { Assignment, Van } from '../types/api'

// A driver's (or student's) current assignment: the most recently created one active today.
// Same rule the Students/Fleet/Dashboard pages already used; display-only, not authoritative.
export function currentAssignmentBy(assignments: Assignment[], key: 'driver_user_id' | 'student_id' | 'van_id') {
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

// Short form for tight table cells: "Van 04", or the plate when there's no number.
export function vanShort(v: VanLike): string {
  return v.number ? `Van ${v.number}` : v.license_plate
}

// "Van 04 · KX-4471" or "Ford Transit · KX-4471".
export function vanLabel(v: VanLike | null | undefined): string {
  if (!v) return 'No van'
  return `${vanName(v)} · ${v.license_plate}`
}
