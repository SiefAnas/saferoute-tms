// Plain Node test (no rendering): the multi-file import parser and plan, against invented files
// with the shape of real customer route sheets (test/fixtures/importShapes.ts). Each workbook is
// built in memory with SheetJS and read back the way the page reads an upload.
import * as XLSX from 'xlsx'
import { sheetsFromWorkbook } from '../src/lib/sheet.ts'
import { parseSheet, findHeaderRow, readDriverCell, parseDayList } from '../src/lib/sheetParse.ts'
import type { ParsedSheet, RawSheet } from '../src/lib/sheetParse.ts'
import { buildPlan, reconcile, rowsToCommit, studentKey, summaryLine } from '../src/lib/importPlan.ts'
import { context, DRIVERS_A, JUNK_SHEET, shapeA, shapeB } from './fixtures/importShapes.ts'

let pass = 0
let fail = 0
function eq(label: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ✓ ${label}`) }
  else { fail++; console.log(`  ✗ ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`) }
}

// Build an .xlsx in memory and read it back, like an uploaded file.
function workbook(file: string, sheets: Record<string, string[][]>): RawSheet[] {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name)
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return sheetsFromWorkbook(XLSX, XLSX.read(bytes), file)
}

const ctx = context()
const A = workbook('Canton_Routes.xlsx', shapeA())
const B = workbook('Quincy_Routes.xlsx', shapeB())
const JUNK = workbook('Misc.xlsx', { 'Oct totals': JUNK_SHEET })
const parsed = (raws: RawSheet[]) => raws.map((r) => parseSheet(r, ctx))
const pa = parsed(A)
const pb = parsed(B)
const pj = parsed(JUNK)
const sheet = (list: ParsedSheet[], name: string) => list.find((s) => s.sheet === name)!
const line = (s: ParsedSheet, name: string) => s.lines.find((l) => l.student.full_name?.value === name)!
const colFor = (s: ParsedSheet, target: string) => s.columns.find((c) => c.target === target)

console.log('--- header row ---')
eq('shape A: 8 sheets read', A.length, 8)
eq('shape A: header found on row 1', pa.map((s) => s.header?.value).every((v) => v === 0), true)
eq('shape B: header found on row 3 (two junk rows above)', pb.map((s) => s.header?.value).every((v) => v === 2), true)
eq('shape B: the junk rows are ignored as "above the header row"', sheet(pb, 'Iris').ignored.filter((r) => r.reason === 'above the header row').map((r) => r.line), [1, 2])
eq('a header guess carries a reason', /look like column names, after 2 rows above it/.test(sheet(pb, 'Iris').header!.reason), true)
eq('a grid with no column names has no header row', findHeaderRow(JUNK_SHEET), null)

console.log('\n--- what each sheet is ---')
eq('every shape A sheet is a route sheet', pa.every((s) => s.kind.value === 'route'), true)
eq('every shape B sheet is a route sheet', pb.every((s) => s.kind.value === 'route'), true)
eq('the guess says why', /Student Name and School/.test(sheet(pa, 'Avery').kind.reason), true)
eq('the junk sheet is unreadable', pj[0].kind.value, 'unreadable')

console.log('\n--- columns ---')
const vanCol = colFor(sheet(pb, 'Iris'), 'van')
eq('the unnamed column maps to van', vanCol?.header, '')
eq('with a reason counting the values', vanCol?.reason, 'column had no header, 3 of 3 values look like Van N')
const gradeCol = colFor(sheet(pb, 'Jonah'), 'grade')
eq('the unnamed "Grade 10" column maps to grade', [gradeCol?.header, gradeCol?.index], ['', 11])
eq('the grade lands on the student', line(sheet(pb, 'Jonah'), 'Tess Pretend').student.grade?.value, '10')
eq('Notes/Accommodations maps to notes', colFor(sheet(pb, 'Iris'), 'notes')?.header, 'Notes/Accommodations')
eq('Student Number maps to the student id', colFor(sheet(pb, 'Iris'), 'student_id')?.header, 'Student Number')
eq('shape A has no van column', colFor(sheet(pa, 'Avery'), 'van'), undefined)

console.log('\n--- driver from the sheet name ---')
eq('a blank Driver cell takes the sheet\'s driver', line(sheet(pa, 'Dana'), 'Pupil Dana One').driver?.value.full_name, 'Dana Fox')
eq('and says why', /Driver column is blank, so the sheet's driver: the sheet is named "Dana"/.test(line(sheet(pa, 'Dana'), 'Pupil Dana One').driver!.reason), true)
const goal = sheet(pb, 'GOAL')
eq('the sheet named after a school fails the driver check', goal.sheetDriver, null)
eq('and is reported, not guessed', goal.problems[0], 'could not tell who drives this sheet: "GOAL" is not the name of one of your drivers')
eq('its blank-Driver row has no driver', line(goal, 'Zed Nonexistent').driver, null)
eq('its row that names a driver keeps that driver', line(goal, 'Yara Pretendson').driver?.value.full_name, 'Liam Shaw')

console.log('\n--- multi-value Driver and time cells ---')
const avery = sheet(pa, 'Avery')
const mila = line(avery, 'Mila Testa')
eq('"Afternoon Only" becomes a shift', mila.shift?.value, 'afternoon')
eq('not a driver: the sheet\'s driver drives', mila.driver?.value.full_name, 'Avery Stone')
const noah = line(avery, 'Noah Sample')
eq('"Booster Seat" becomes a note', noah.notes.map((n) => n.text), ['Booster Seat'])
eq('not a driver', noah.driver?.value.full_name, 'Avery Stone')
const omar = line(avery, 'Omar Fiction')
eq('"Monitor" sets the monitor flag', omar.monitor?.value, true)
eq('and lands in notes', omar.notes[0]?.text, 'Monitor')
const pia = line(sheet(pa, 'Casey'), 'Pia Notreal')
eq('"Blake Morning" is a driver and a shift', [pia.driver?.value.full_name, pia.shift?.value], ['Blake Rivera', 'morning'])
eq('an unknown word in Driver is kept as a note with a reason', readDriverCell('Purple', DRIVERS_A).notes[0]?.reason, 'the Driver column says "Purple"; it is not a driver, shift or accommodation we know, so it was kept as a note')
const rory = line(sheet(pb, 'Iris'), 'Rory Invent')
eq('"Afternoon" in Drop Off is a shift', rory.shift?.value, 'afternoon')
eq('not a time', rory.dropoff, null)
eq('the Pick Up time still reads', rory.pickup?.value, '06:55')
eq('"Morning Only" in Pick Up is a shift', line(sheet(pb, 'Iris'), 'Sage Unreal').shift?.value, 'morning')
eq('times are read as 24-hour', [line(avery, 'Leo Shared').pickup?.value, line(avery, 'Leo Shared').dropoff?.value], ['07:00', '14:30'])
eq('Monitor "Yes" sets the flag and a note', [rory.monitor?.value, rory.notes.map((n) => n.text)], [true, ['Car seat', 'Needs a monitor']])

console.log('\n--- note rows ---')
eq('"M/W/Th" attaches to the student above it', omar.notes.map((n) => n.text), ['Monitor', 'M/W/Th'])
eq('and is read as that student\'s days', omar.days?.value, [1, 3, 4])
eq('"Tuesday/Friday" too', pia.days?.value, [2, 5])
eq('day lists parse', [parseDayList('M/W/Th'), parseDayList('Mon, Wed'), parseDayList('Leo')], [[1, 3, 4], [1, 3], null])
eq('the trailing note attaches to the last student', line(sheet(pb, 'Iris'), 'Sage Unreal').notes.map((n) => n.text), ['Note: Wednesday Early Release at 12:30'])
eq('note rows are not students', sheet(pa, 'Avery').lines.some((l) => /M\/W\/Th/.test(l.student.full_name?.value ?? '')), false)
eq('blank rows are not students', sheet(pa, 'Avery').lines.length, 6)
eq('the second header row on Kira is ignored', sheet(pb, 'Kira').ignored.some((r) => r.reason === 'a second header row'), true)

console.log('\n--- plan: one student, many assignments ---')
const plan = buildPlan([...pa, ...pb, ...pj], ctx, { startDate: '2026-11-02', maxRows: 100, knownSchools: [] })
const students = plan.rows.students ?? []
const assignments = plan.rows.assignments ?? []
const leo = students.filter((s) => s.row.full_name === 'Leo Shared')
eq('a student on three sheets is one student', leo.length, 1)
eq('with three assignments', assignments.filter((a) => a.key === studentKey('Leo Shared', 'CHS')).map((a) => a.row.shift_period).sort(), ['', 'afternoon', 'morning'])
eq('and all three sightings as sources', leo[0].sources.map((s) => s.sheet), ['Avery', 'Blake', 'Casey'])
eq('the duplicated sheet adds no duplicate students', students.filter((s) => s.row.full_name === 'Rory Invent').length, 1)
eq('nor a duplicate assignment (same driver, van, times)', assignments.filter((a) => a.key === studentKey('Rory Invent', 'QHS')).length, 1)
eq('the address is split into street, city, state, zip', [leo[0].row.street_address, leo[0].row.city, leo[0].row.state, leo[0].row.zip_code], ['8 Cedar Ct', 'Canton', 'MA', '02021'])
const rRow = students.find((s) => s.row.full_name === 'Rory Invent')!
eq('notes are collected on the student', rRow.row.notes, 'Car seat; Needs a monitor')
const omarA = assignments.find((a) => a.key === studentKey('Omar Fiction', 'HAN'))!
eq('the note row\'s days go on the assignment', omarA.row.days_of_week, '1,3,4')
eq('no van column: the driver\'s van today, with a reason', [omarA.row.van_plate, /Avery Stone drives TST-101 today/.test(omarA.reasons.join(' '))], ['TST-101', true])
eq('"Van 3" is looked up by number', assignments.find((a) => a.key === studentKey('Wren Imagined', 'QHS'))?.row.van_plate, 'TST-103')
eq('the start date comes from the page', omarA.row.start_date, '2026-11-02')
eq('schools are made from route sheets, one row each', (plan.rows.schools ?? []).map((s) => s.row.name).sort(), ['CHS', 'GMS', 'GOAL', 'HAN', 'JFK', 'QHS'])
eq('a school SafeTurns already has is not made again', (buildPlan(pa, ctx, { startDate: '2026-11-02', maxRows: 100, knownSchools: ['chs'] }).rows.schools ?? []).some((s) => s.row.name === 'CHS'), false)

console.log('\n--- what needs you ---')
eq('the junk sheet is listed and skipped', plan.needs.some((n) => n.what === 'Misc.xlsx > sheet "Oct totals"' && /^skipped: none of the first 10 rows/.test(n.why)), true)
eq('the other sheets still import', students.length > 20, true)
eq('the GOAL sheet is listed', plan.needs.some((n) => /sheet "GOAL"/.test(n.what) && /could not tell who drives this sheet/.test(n.why)), true)
eq('Zed has a student row but no assignment', [students.some((s) => s.row.full_name === 'Zed Nonexistent'), assignments.some((a) => a.row.student_name === 'Zed Nonexistent')], [true, false])
eq('and Zed\'s assignment is listed with why', plan.needs.find((n) => n.what === 'Zed Nonexistent (assignment)')?.why, 'could not tell who drives this sheet')
eq('a note with nothing above it is listed', plan.needs.some((n) => /GOAL dismisses/.test(n.what)), false)

console.log('\n--- limits are per type ---')
const big: Record<string, string[][]> = { Avery: [['School', 'Student Name', 'School Address', 'Student Address', 'Phone', 'Driver']] }
for (let i = 0; i < 101; i++) big.Avery.push(['CHS', `Pupil Number ${i}`, '100 Test High Rd, Canton, MA 02021', `${i} Elm St, Canton, MA 02021`, '555-010-1234', ''])
const bigPlan = buildPlan(parsed(workbook('Big.xlsx', big)), ctx, { startDate: '2026-11-02', maxRows: 100, knownSchools: [] })
eq('101 students names the student type, and by how much', bigPlan.overLimit.find((o) => o.type === 'students'), { type: 'students', count: 101, max: 100, over: 1 })
eq('the schools type is not over', bigPlan.overLimit.some((o) => o.type === 'schools'), false)

console.log('\n--- after the preview: order and the student cascade ---')
const small = buildPlan([sheet(pb, 'Liam'), sheet(pb, 'Iris')], ctx, { startDate: '2026-11-02', maxRows: 100, knownSchools: [] })
const names = small.rows.students!.map((s) => s.row.full_name)
// What the server would say before anything is saved: the school isn't there yet, and so on.
const previews = {
  schools: small.rows.schools!.map(() => ({ action: 'create' as const, reason: null })),
  students: small.rows.students!.map((s) => (s.row.full_name === 'Sage Unreal'
    ? { action: 'error' as const, reason: 'Missing: Grade, Age, Parent name' }
    : { action: 'error' as const, reason: `School "${s.row.school}" was not found. Import your schools first (Import, then Schools), then import the students.` })),
  assignments: small.rows.assignments!.map((a) => ({ action: 'error' as const, reason: `No student named "${a.row.student_name}" at ${a.row.school}. Import the students first.` })),
}
const st = reconcile(small, previews)
eq('a student waiting on a school in the same upload goes in after it', st.students[names.indexOf('Xan Storybook')].state, 'after')
eq('a student with a real error needs you', [st.students[names.indexOf('Sage Unreal')].state, st.students[names.indexOf('Sage Unreal')].reason], ['needs', 'Missing: Grade, Age, Parent name'])
const aIdx = (n: string) => small.rows.assignments!.findIndex((a) => a.row.student_name === n)
eq('its assignment is skipped and says why', [st.assignments[aIdx('Sage Unreal')].state, st.assignments[aIdx('Sage Unreal')].reason], ['skipped', 'skipped because the student row above it could not be imported'])
eq('an assignment waiting on its student goes in after it', st.assignments[aIdx('Xan Storybook')].state, 'after')
const commitA = rowsToCommit(small, st, 'assignments', new Set([studentKey('Quinn Madeup', 'QHS')]))
eq('a student that failed at commit drops its assignment too', [commitA.send.some((r) => r.row.student_name === 'Quinn Madeup'), commitA.skipped.length], [false, 1])
eq('the skipped assignment is never sent', commitA.send.some((r) => r.row.student_name === 'Sage Unreal'), false)
eq('summary line', summaryLine({ students: 38, assignments: 41 }, 3), '38 students in, 41 assignments in, 3 rows need you.')

console.log(`\n==== importParse: ${pass} passed, ${fail} failed ====`)
if (fail) process.exit(1)
