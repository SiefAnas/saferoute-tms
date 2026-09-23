// Plain Node test, same style as payrollCycle.test.ts. Runs every check under three timezones
// (Node picks up a changed process.env.TZ right away), because the old toISOString() code gave
// wrong answers in Boston at night and in Cairo at midnight. Works the same on Windows.
import { localISODate, calendarDateOf, addDaysISO, mondayOf, localDateOf } from '../src/lib/localDate.ts'
import { isAssignmentActiveToday } from '../src/lib/format.ts'
import { rangesOverlap } from '../src/lib/assignmentRules.ts'

let pass = 0
let fail = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (actual === expected) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
}

for (const tz of ['America/New_York', 'Africa/Cairo', 'UTC']) {
  process.env.TZ = tz
  console.log(`--- localDate (TZ=${tz}) ---`)
  // 9:30pm local on Sept 22 is still Sept 22, even though UTC is already Sept 23 in Boston.
  eq('late evening stays today', localISODate(new Date(2026, 8, 22, 21, 30)), '2026-09-22')
  // local midnight on the 1st stays the 1st, even though UTC is still the 31st in Cairo.
  eq('local midnight stays same day', localISODate(new Date(2026, 8, 1, 0, 0)), '2026-09-01')
  eq('API date string keeps its date', calendarDateOf('2026-09-22T00:00:00.000Z'), '2026-09-22')
  eq('plain date string unchanged', calendarDateOf('2026-09-22'), '2026-09-22')

  const today = localISODate()
  const tomorrowD = new Date(); tomorrowD.setDate(tomorrowD.getDate() + 1)
  const yesterdayD = new Date(); yesterdayD.setDate(yesterdayD.getDate() - 1)
  const tomorrow = localISODate(tomorrowD)
  const yesterday = localISODate(yesterdayD)
  eq('assignment ending today is still active', isAssignmentActiveToday(`${yesterday}T00:00:00.000Z`, `${today}T00:00:00.000Z`), true)
  eq('assignment starting tomorrow is not active yet', isAssignmentActiveToday(`${tomorrow}T00:00:00.000Z`, null), false)
  eq('assignment ended yesterday is not active', isAssignmentActiveToday('2026-01-01T00:00:00.000Z', `${yesterday}T00:00:00.000Z`), false)
  eq('ranges touching on same day overlap', rangesOverlap('2026-09-22', null, '2026-09-01T00:00:00.000Z', '2026-09-22T00:00:00.000Z'), true)
  eq('ranges a day apart do not overlap', rangesOverlap('2026-09-23', null, '2026-09-01T00:00:00.000Z', '2026-09-22T00:00:00.000Z'), false)

  // Week tab helpers.
  eq('next week', addDaysISO('2026-09-21', 7), '2026-09-28')
  eq('previous week across a month', addDaysISO('2026-10-02', -7), '2026-09-25')
  eq('across a year end', addDaysISO('2026-12-28', 7), '2027-01-04')
  eq('across US DST end (Nov 1 2026)', addDaysISO('2026-10-26', 7), '2026-11-02')
  eq('across US DST start (Mar 8 2026)', addDaysISO('2026-03-02', 7), '2026-03-09')
  eq('Monday of a Wednesday', mondayOf(new Date(2026, 8, 23, 22, 0)), '2026-09-21')
  eq('Monday of a Sunday is the Monday before', mondayOf(new Date(2026, 8, 27, 9, 0)), '2026-09-21')
  eq('Monday of a Monday is itself', mondayOf(new Date(2026, 8, 21, 0, 0)), '2026-09-21')
  eq('local date of a calendar string keeps the day', localDateOf('2026-09-21').getDate(), 21)

}

console.log(`==== localDate: ${pass} passed, ${fail} failed ====`)
if (fail) process.exit(1)
