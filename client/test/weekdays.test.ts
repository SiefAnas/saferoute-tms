// Plain Node test, same style as localDate.test.ts: weekday labels, "runs today" and the
// weekday part of the assignment conflict rules.
import { assignmentRunsToday, formatWeekdays, isoWeekday } from '../src/lib/weekdays.ts'
import { daysOverlap, studentsTakenByOtherDrivers } from '../src/lib/assignmentRules.ts'
import { localISODate } from '../src/lib/localDate.ts'
import type { Assignment } from '../src/types/api.ts'

let pass = 0
let fail = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
}

console.log('--- weekday labels ---')
eq('Mon–Fri', formatWeekdays([1, 2, 3, 4, 5]), 'Mon–Fri')
eq('every day', formatWeekdays([7, 6, 5, 4, 3, 2, 1]), 'Every day')
eq('weekend (two days stay a list)', formatWeekdays([6, 7]), 'Sat, Sun')
eq('gaps', formatWeekdays([1, 3, 5]), 'Mon, Wed, Fri')
eq('range plus a single day', formatWeekdays([1, 2, 3, 5]), 'Mon–Wed, Fri')
eq('missing list means the default', formatWeekdays(undefined), 'Mon–Fri')

console.log('--- ISO weekday of a local date ---')
eq('Monday is 1', isoWeekday(new Date(2026, 8, 21)), 1)
eq('Sunday is 7', isoWeekday(new Date(2026, 8, 27, 23, 30)), 7)

console.log('--- runs today ---')
const todayNo = isoWeekday()
const base = { start_date: `${localISODate()}T00:00:00.000Z`, end_date: null }
eq("runs today when today's weekday is picked", assignmentRunsToday({ ...base, days_of_week: [todayNo] }), true)
eq("doesn't run today when today's weekday isn't picked", assignmentRunsToday({ ...base, days_of_week: [1, 2, 3, 4, 5, 6, 7].filter((d) => d !== todayNo) }), false)
eq('not yet started', assignmentRunsToday({ start_date: '2999-01-01', end_date: null, days_of_week: [1, 2, 3, 4, 5, 6, 7] }), false)

console.log('--- conflicts only on shared days ---')
eq('Mon–Wed vs Thu–Fri: no overlap', daysOverlap([1, 2, 3], [4, 5]), false)
eq('Mon–Wed vs Wed: overlap', daysOverlap([1, 2, 3], [3]), true)
eq('missing lists mean Mon–Fri', daysOverlap(undefined, [5]), true)
const taken = (days: number[]) => studentsTakenByOtherDrivers(
  [{ id: 'a1', student_id: 's1', driver_user_id: 'd1', van_id: 'v1', start_date: '2026-01-01', end_date: null, shift_period: 'both', days_of_week: [1, 2, 3] } as Assignment],
  'd2',
  { start_date: '2026-09-21', end_date: null, days_of_week: days },
)
eq('student picker: free on days the other driver has off', [...taken([4, 5])], [])
eq('student picker: taken when days are shared', [...taken([3, 4])], ['s1'])

console.log(`\n==== weekdays: ${pass} passed, ${fail} failed ====`)
process.exit(fail === 0 ? 0 : 1)
