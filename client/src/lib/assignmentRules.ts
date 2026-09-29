import type { Assignment } from '../types/api'

// Client-side mirror of server/src/services/assignmentConflicts.js — used to filter picker
// options live (§7 item 3: "block invalid combinations at the point of picking"). The server
// re-derives and enforces the same rules on save; this is a UX layer, not the source of truth.
function dayNumber(dateLike: string): number {
  const d = new Date(dateLike)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

export function rangesOverlap(aStart: string, aEnd: string | null, bStart: string, bEnd: string | null): boolean {
  const aStartNum = dayNumber(aStart)
  const aEndNum = aEnd == null ? Infinity : dayNumber(aEnd)
  const bStartNum = dayNumber(bStart)
  const bEndNum = bEnd == null ? Infinity : dayNumber(bEnd)
  return aStartNum <= bEndNum && bStartNum <= aEndNum
}

interface Range {
  start_date: string
  end_date: string | null
}

// Mirrors server/src/services/assignmentConflicts.js's shiftsOverlap: 'both' overlaps
// everything, 'morning'/'afternoon' only overlap themselves or 'both'.
export function shiftsOverlap(a: Assignment['shift_period'], b: Assignment['shift_period']): boolean {
  if (a === 'both' || b === 'both') return true
  return a === b
}

function overlapping(assignments: Assignment[], range: Range, excludeId?: string): Assignment[] {
  return assignments.filter((a) => a.id !== excludeId && rangesOverlap(range.start_date, range.end_date, a.start_date, a.end_date))
}

// The van a driver is already driving during this date range, if any (there should be at
// most one — the server rejects anything that would create a second). Null means the driver
// is free to be paired with any available van for this range.
export function driverCurrentVanId(assignments: Assignment[], driverId: string, range: Range, excludeId?: string): string | null {
  const row = overlapping(assignments, range, excludeId).find((a) => a.driver_user_id === driverId)
  return row ? row.van_id : null
}

// Vans already driven by a DIFFERENT driver during this date range — exclude these from the
// van picker once a driver is chosen (unless it's the driver's own current van, above).
export function vansTakenByOtherDrivers(assignments: Assignment[], driverId: string, range: Range, excludeId?: string): Set<string> {
  return new Set(
    overlapping(assignments, range, excludeId)
      .filter((a) => a.driver_user_id !== driverId)
      .map((a) => a.van_id),
  )
}

// Students already assigned to a DIFFERENT driver for an overlapping shift during this date
// range — exclude these from the student picker once a driver (and shift) is chosen. A
// student with a 'morning' assignment to one driver can still be picked for 'afternoon' with
// another.
export function studentsTakenByOtherDrivers(
  assignments: Assignment[],
  driverId: string,
  range: Range,
  shiftPeriod: Assignment['shift_period'] = 'both',
  excludeId?: string,
): Set<string> {
  return new Set(
    overlapping(assignments, range, excludeId)
      .filter((a) => a.driver_user_id !== driverId && shiftsOverlap(a.shift_period, shiftPeriod))
      .map((a) => a.student_id),
  )
}
