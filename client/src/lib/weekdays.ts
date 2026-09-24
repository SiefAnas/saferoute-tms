import { isAssignmentActiveToday } from './format.ts'

// Days an assignment runs: ISO weekday numbers, 1 = Monday ... 7 = Sunday (the server stores
// the same, assignments.days_of_week). New assignments default to Monday to Friday.
export const WEEKDAYS = [
  { n: 1, short: 'Mon', long: 'Monday' },
  { n: 2, short: 'Tue', long: 'Tuesday' },
  { n: 3, short: 'Wed', long: 'Wednesday' },
  { n: 4, short: 'Thu', long: 'Thursday' },
  { n: 5, short: 'Fri', long: 'Friday' },
  { n: 6, short: 'Sat', long: 'Saturday' },
  { n: 7, short: 'Sun', long: 'Sunday' },
] as const

export const MON_TO_FRI = [1, 2, 3, 4, 5]

// ISO weekday of a local Date: Monday = 1 ... Sunday = 7.
export function isoWeekday(d: Date = new Date()): number {
  return ((d.getDay() + 6) % 7) + 1
}

// "Mon–Fri", "Every day", "Sat–Sun", "Mon, Wed, Fri". Runs of 3+ days in a row become a range.
export function formatWeekdays(days: readonly number[] | undefined): string {
  const set = [...new Set(days ?? MON_TO_FRI)].sort((a, b) => a - b)
  if (set.length === 7) return 'Every day'
  const parts: string[] = []
  for (let i = 0; i < set.length; ) {
    let j = i
    while (j + 1 < set.length && set[j + 1] === set[j] + 1) j++
    const name = (n: number) => WEEKDAYS[n - 1].short
    if (j - i >= 2) parts.push(`${name(set[i])}–${name(set[j])}`)
    else for (let k = i; k <= j; k++) parts.push(name(set[k]))
    i = j + 1
  }
  return parts.join(', ')
}

// True if the assignment is in its date range today AND runs on today's weekday. For views
// about today's actual runs (dashboard). "Which driver does this student have" views keep
// using the date range only.
export function assignmentRunsToday(a: { start_date: string; end_date: string | null; days_of_week?: number[] }): boolean {
  return isAssignmentActiveToday(a.start_date, a.end_date) && (a.days_of_week ?? MON_TO_FRI).includes(isoWeekday())
}
