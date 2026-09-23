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

// "Ford Transit · KX-4471". Vans have no fleet number ("Van 04") in the data model yet.
export function vanLabel(v: Pick<Van, 'brand' | 'model' | 'license_plate'> | null | undefined): string {
  if (!v) return 'No van'
  return `${v.brand} ${v.model} · ${v.license_plate}`
}
