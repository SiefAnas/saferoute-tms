// From parsed sheets (sheetParse.ts) to the rows each import type gets, plus everything that needs
// the admin. Pure, no React, unit tested. The server still checks every row (POST /imports/preview
// and /imports/commit); this only decides what to send, in which order, and what a server error
// means when the record it needs is in the same upload.
//
// Order: schools, vans, drivers, monitors, parents, students, assignments (then school staff).
// A route sheet line makes a student row AND an assignment row. A student is one student across
// every sheet (name + school); the same student on three sheets is one student, three assignments.
import type { KnownDriver, ParseContext, ParsedSheet, RouteLine, SourceRef } from './sheetParse.ts'
import { norm, vanNumberOf } from './sheetParse.ts'

export const IMPORT_ORDER = ['schools', 'vans', 'drivers', 'monitors', 'parents', 'students', 'assignments', 'staff'] as const

export interface PlanRow {
  row: Record<string, string>
  sources: SourceRef[]
  reasons: string[] // how values were worked out, for the review screen
  key?: string // students: name|school; assignments: the student's key
}

export interface NeedsYou {
  source: SourceRef | null
  type: string | null
  what: string // "Ava Kim", "sheet Terri"
  why: string
}

export interface OverLimit { type: string; count: number; max: number; over: number }

export interface ImportPlan {
  rows: Record<string, PlanRow[]>
  needs: NeedsYou[]
  overLimit: OverLimit[]
  ignored: number // junk / blank / second-header rows dropped
}

export interface PlanOptions {
  startDate: string // 'YYYY-MM-DD', for new assignments (route sheets have no start date)
  maxRows: number // per import type
  knownSchools: string[] // names of the company's schools already in SafeTurns
}

const lc = (s: string | undefined) => String(s ?? '').trim().toLowerCase()
export const studentKey = (name: string, school: string) => `${lc(name)}|${lc(school)}`
export const where = (s: SourceRef | null) => (s ? `${s.file} > ${s.sheet} > line ${s.line}` : '')

const STUDENT_FIELDS = ['full_name', 'school', 'student_id', 'grade', 'age', 'parent_name', 'parent_phone', 'parent_email', 'street_address', 'city', 'state', 'zip_code', 'notes']

function addUnique<T>(list: T[], items: T[]) {
  for (const x of items) if (!list.includes(x)) list.push(x)
}

// The van a route line rides in, as a license plate. An explicit "Van 3" is looked up by number
// in the fleet; with no van on the sheet, the van the driver drives today.
function resolveVan(l: RouteLine, driver: KnownDriver | null, ctx: ParseContext): { plate: string; reason: string } | { problem: string } {
  if (l.van) {
    const num = vanNumberOf(l.van.value)
    if (num) {
      const v = ctx.vans.find((x) => x.number && norm(x.number) === norm(num))
      return v ? { plate: v.license_plate, reason: `${l.van.reason}: your van number ${num} is ${v.license_plate}` } : { problem: `${l.van.value} is not in your fleet (no van has number ${num})` }
    }
    const v = ctx.vans.find((x) => norm(x.license_plate) === norm(l.van!.value) || (x.number && norm(x.number) === norm(l.van!.value)))
    return v ? { plate: v.license_plate, reason: l.van.reason } : { problem: `"${l.van.value}" is not a van in your fleet` }
  }
  if (driver && ctx.driverVan[driver.id]) return { plate: ctx.driverVan[driver.id], reason: `the sheet has no van, and ${driver.full_name} drives ${ctx.driverVan[driver.id]} today` }
  return { problem: driver ? `the sheet has no van, and ${driver.full_name} has no van assigned today` : 'the sheet has no van' }
}

export function buildPlan(sheets: ParsedSheet[], ctx: ParseContext, opts: PlanOptions): ImportPlan {
  const rows: Record<string, PlanRow[]> = {}
  const add = (type: string, r: PlanRow) => (rows[type] ??= []).push(r)
  const needs: NeedsYou[] = []
  let ignored = 0

  const students = new Map<string, PlanRow>()
  const studentNotes = new Map<string, string[]>()
  const schools = new Map<string, { name: string; addresses: Map<string, SourceRef[]> }>()
  const assignments = new Map<string, PlanRow>()

  const putStudent = (row: Record<string, string>, source: SourceRef, reasons: string[], notes: string[]) => {
    const key = studentKey(row.full_name, row.school)
    const have = students.get(key)
    if (!have) {
      students.set(key, { row: Object.fromEntries(STUDENT_FIELDS.map((k) => [k, row[k] ?? ''])), sources: [source], reasons: [...reasons], key })
      studentNotes.set(key, [...notes])
      return
    }
    // Seen on another sheet: one student. Fill what the first sighting left blank.
    have.sources.push(source)
    for (const k of STUDENT_FIELDS) {
      if (k === 'notes') continue
      if (!have.row[k] && row[k]) have.row[k] = row[k]
    }
    addUnique(studentNotes.get(key)!, notes)
    addUnique(have.reasons, reasons)
  }

  for (const s of sheets) {
    ignored += s.ignored.length
    const sheetRef = { file: s.file, sheet: s.sheet, line: (s.header?.value ?? 0) + 1 }
    if (s.kind.value === 'unreadable') {
      needs.push({ source: null, type: null, what: `${s.file} > sheet "${s.sheet}"`, why: `skipped: ${s.kind.reason}` })
      continue
    }
    for (const n of s.notes) needs.push({ source: n.source, type: null, what: `note "${n.text}"`, why: 'a note with no row above it to attach to' })

    if (s.kind.value !== 'route') {
      for (const r of s.records) {
        if (s.kind.value === 'students') putStudent(r.row, r.source, [`from the ${s.sheet} sheet, read as a students sheet`], r.row.notes ? [r.row.notes] : [])
        else add(s.kind.value, { row: r.row, sources: [r.source], reasons: [`from sheet "${s.sheet}" (${s.kind.reason})`], key: s.kind.value === 'assignments' ? studentKey(r.row.student_name, r.row.school) : undefined })
      }
      continue
    }

    if (s.problems.length && s.lines.some((l) => !l.driver)) {
      needs.push({ source: sheetRef, type: 'assignments', what: `${s.file} > sheet "${s.sheet}"`, why: s.problems.join('; ') })
    }
    for (const l of s.lines) {
      const st = Object.fromEntries(Object.entries(l.student).map(([k, g]) => [k, g.value]))
      if (!st.school) {
        needs.push({ source: l.source, type: 'students', what: st.full_name, why: 'this row has no school' })
        continue
      }
      putStudent(st, l.source, Object.entries(l.student).filter(([, g]) => g.confidence < 0.9).map(([k, g]) => `${k}: ${g.reason}`), l.notes.map((n) => n.text))
      const sk = lc(st.school)
      if (!schools.has(sk)) schools.set(sk, { name: st.school, addresses: new Map() })
      if (l.schoolAddress) {
        const a = schools.get(sk)!.addresses
        a.set(l.schoolAddress.value, [...(a.get(l.schoolAddress.value) ?? []), l.source])
      }

      const key = studentKey(st.full_name, st.school)
      if (!l.driver) {
        needs.push({ source: l.source, type: 'assignments', what: `${st.full_name} (assignment)`, why: l.problems.join('; ') || 'could not tell who drives this student' })
        continue
      }
      const van = resolveVan(l, l.driver.value, ctx)
      if ('problem' in van) {
        needs.push({ source: l.source, type: 'assignments', what: `${st.full_name} (assignment)`, why: van.problem })
        continue
      }
      const row = {
        student_name: st.full_name, school: st.school, student_id: st.student_id ?? '', driver_email: l.driver.value.email, van_plate: van.plate,
        start_date: opts.startDate, end_date: '', pickup_time: l.pickup?.value ?? '', dropoff_time: l.dropoff?.value ?? '',
        shift_period: l.shift?.value ?? '', days_of_week: l.days ? l.days.value.join(',') : '',
      }
      const reasons = [l.driver.reason, van.reason, l.shift?.reason, l.days?.reason].filter((x): x is string => Boolean(x))
      // The same line twice (a sheet repeated in another file or tab) is one assignment.
      const ak = [key, row.driver_email, row.van_plate, row.shift_period, row.pickup_time, row.dropoff_time, row.days_of_week].join('|')
      const have = assignments.get(ak)
      if (have) have.sources.push(l.source)
      else assignments.set(ak, { row, sources: [l.source], reasons, key })
    }
  }

  // Schools named on route sheets that SafeTurns doesn't have yet.
  const known = new Set(opts.knownSchools.map(lc))
  for (const [k, s] of schools) {
    if (known.has(k)) continue
    const addrs = [...s.addresses.keys()]
    const src = [...s.addresses.values()].flat()
    if (addrs.length === 0) needs.push({ source: null, type: 'schools', what: `school "${s.name}"`, why: 'it is not one of your schools yet and the files give no address for it. Add it on the Schools page.' })
    else if (addrs.length > 1) needs.push({ source: src[0], type: 'schools', what: `school "${s.name}"`, why: `the files give ${addrs.length} different addresses for it: ${addrs.join(' / ')}` })
    else add('schools', { row: { name: s.name, address: addrs[0], state: '', zip_code: '', phone: '', hours: '', website: '' }, sources: src, reasons: [`named on route sheets with the address "${addrs[0]}"`] })
  }

  for (const [key, st] of students) {
    st.row.notes = [st.row.notes, ...(studentNotes.get(key) ?? [])].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join('; ')
    add('students', st)
  }
  for (const a of assignments.values()) add('assignments', a)

  const overLimit: OverLimit[] = []
  for (const [type, list] of Object.entries(rows)) {
    if (list.length > opts.maxRows) overLimit.push({ type, count: list.length, max: opts.maxRows, over: list.length - opts.maxRows })
  }
  return { rows, needs, overLimit, ignored }
}

// ---- after the server's preview -------------------------------------------------------------------

export type RowState = 'ready' | 'after' | 'needs' | 'skipped'
export interface RowStatus { state: RowState; action: 'create' | 'update' | null; reason: string | null }
export interface ServerPreviewRow { action: 'create' | 'update' | 'error'; reason: string | null; note?: string | null }

const SKIPPED_STUDENT = 'skipped because the student row above it could not be imported'

// The server previews each type on its own, before anything earlier in the order is saved, so a
// student whose school is in this same upload reads "School X was not found". Those rows are
// marked 'after' (they go in once the row they need is in), not errors. An assignment whose
// student can't be imported is 'skipped', never sent: no assignment pointing at nothing.
export function reconcile(plan: ImportPlan, previews: Record<string, ServerPreviewRow[]>): Record<string, RowStatus[]> {
  const out: Record<string, RowStatus[]> = {}
  const blocked = new Set(plan.overLimit.map((o) => o.type))
  const ok = (type: string, i: number) => {
    const s = out[type]?.[i]
    return s?.state === 'ready' || s?.state === 'after'
  }
  const findOk = (type: string, test: (r: Record<string, string>) => boolean) =>
    (plan.rows[type] ?? []).some((r, i) => test(r.row) && ok(type, i))

  for (const type of [...IMPORT_ORDER, ...Object.keys(plan.rows).filter((t) => !(IMPORT_ORDER as readonly string[]).includes(t))]) {
    const list = plan.rows[type]
    if (!list) continue
    const over = plan.overLimit.find((o) => o.type === type)
    out[type] = list.map((r, i) => {
      if (blocked.has(type)) return { state: 'needs' as const, action: null, reason: `${over!.count} ${type} rows in this upload, ${over!.over} over the limit of ${over!.max} per type. Upload fewer files at once.` }
      if (type === 'assignments') {
        const si = (plan.rows.students ?? []).findIndex((s) => s.key === r.key)
        if (si >= 0 && !ok('students', si)) return { state: 'skipped' as const, action: null, reason: SKIPPED_STUDENT }
      }
      const p = previews[type]?.[i]
      if (!p) return { state: 'needs' as const, action: null, reason: 'not checked' }
      if (p.action !== 'error') return { state: 'ready' as const, action: p.action, reason: p.note ?? null }
      const reason = p.reason ?? ''
      const school = /^School "(.+?)" was not found/.exec(reason)?.[1]
      if (school && findOk('schools', (s) => lc(s.name) === lc(school))) return { state: 'after' as const, action: 'create' as const, reason: `goes in after the school ${school} is imported` }
      if (type === 'assignments' && /^No student (named|with Student ID)/.test(reason)) {
        const si = (plan.rows.students ?? []).findIndex((s) => s.key === r.key)
        if (si >= 0 && ok('students', si)) return { state: 'after' as const, action: 'create' as const, reason: 'goes in after the student is imported' }
      }
      const email = /^No driver in your company has the email (.+)\.$/.exec(reason)?.[1]
      if (email && findOk('drivers', (d) => lc(d.email) === lc(email))) return { state: 'after' as const, action: 'create' as const, reason: 'goes in after the driver is imported' }
      const plate = /^No van in your company has the license plate (.+)\.$/.exec(reason)?.[1]
      if (plate && findOk('vans', (v) => lc(v.license_plate) === lc(plate))) return { state: 'after' as const, action: 'create' as const, reason: 'goes in after the van is imported' }
      return { state: 'needs' as const, action: null, reason }
    })
  }
  return out
}

// What to send for a type at commit time: the rows still worth sending, given what the earlier
// types' commits saved. An assignment whose student failed to save is dropped with its reason.
export function rowsToCommit(plan: ImportPlan, statuses: Record<string, RowStatus[]>, type: string, failedStudentKeys: Set<string>) {
  const send: { index: number; row: Record<string, string> }[] = []
  const skipped: { index: number; reason: string }[] = []
  ;(plan.rows[type] ?? []).forEach((r, i) => {
    const s = statuses[type]?.[i]
    if (!s || (s.state !== 'ready' && s.state !== 'after')) return
    if (type === 'assignments' && r.key && failedStudentKeys.has(r.key)) { skipped.push({ index: i, reason: SKIPPED_STUDENT }); return }
    send.push({ index: i, row: r.row })
  })
  return { send, skipped }
}

// "38 students in, 41 assignments in, 3 rows need you." (verb 'ready' before the import runs).
export function summaryLine(counts: Record<string, number>, needs: number, verb = 'in') {
  const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([t, n]) => `${n} ${n === 1 && t !== 'school staff' ? t.replace(/s$/, '') : t} ${verb}`)
  return `${parts.length ? parts.join(', ') : `Nothing ${verb}`}, ${needs} row${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} you.`
}

// ---- running it ------------------------------------------------------------------------------------
// The page and the server integration test (server/test/51) run the same loops.

export type Post = <T>(path: string, body: unknown) => Promise<T>
export interface CommitOutcome {
  counts: Record<string, number> // type -> rows created or updated
  needs: NeedsYou[] // rows that did not go in, with why
  credentials: { full_name: string; email: string; role: string; temporary_password: string }[]
}

export function describeRow(type: string, r: PlanRow) {
  const x = r.row
  if (type === 'assignments') return `${x.student_name} (assignment)`
  if (type === 'students') return x.full_name
  if (type === 'schools') return `school ${x.name}`
  if (type === 'vans') return `van ${x.license_plate}`
  return x.full_name || x.email || 'a row'
}

export const typesToSend = (plan: ImportPlan) => IMPORT_ORDER.filter((t) => plan.rows[t]?.length && !plan.overLimit.some((o) => o.type === t))

// Preview every type (nothing saved), then work out what goes in and in what order.
export async function checkAll(plan: ImportPlan, post: Post) {
  const previews: Record<string, ServerPreviewRow[]> = {}
  for (const type of typesToSend(plan)) {
    previews[type] = (await post<{ rows: ServerPreviewRow[] }>('/imports/preview', { type, rows: plan.rows[type].map((r) => r.row) })).rows
  }
  return reconcile(plan, previews)
}

// Every row the plan or the check says needs the admin.
export function needsOf(plan: ImportPlan, statuses: Record<string, RowStatus[]> | null): NeedsYou[] {
  const out = [...plan.needs]
  for (const [type, list] of Object.entries(statuses ?? {})) {
    list.forEach((s, i) => {
      if (s.state === 'needs' || s.state === 'skipped') out.push({ source: plan.rows[type][i].sources[0], type, what: describeRow(type, plan.rows[type][i]), why: s.reason ?? '' })
    })
  }
  return out
}

// Import in order. A student that fails here takes its assignments with it.
export async function commitAll(plan: ImportPlan, statuses: Record<string, RowStatus[]>, post: Post): Promise<CommitOutcome> {
  const out: CommitOutcome = { counts: {}, needs: [], credentials: [] }
  const failedStudents = new Set<string>()
  for (const type of typesToSend(plan)) {
    const { send, skipped } = rowsToCommit(plan, statuses, type, failedStudents)
    for (const s of skipped) out.needs.push({ source: plan.rows[type][s.index].sources[0], type, what: describeRow(type, plan.rows[type][s.index]), why: s.reason })
    if (!send.length) continue
    const res = await post<{ counts: { created: number; updated: number }; rows: { index: number; status: string; reason: string | null }[]; credentials: CommitOutcome['credentials'] }>('/imports/commit', { type, rows: send.map((s) => s.row) })
    out.counts[type] = res.counts.created + res.counts.updated
    out.credentials.push(...res.credentials)
    for (const r of res.rows) {
      if (r.status !== 'error') continue
      const row = plan.rows[type][send[r.index].index]
      if (type === 'students' && row.key) failedStudents.add(row.key)
      out.needs.push({ source: row.sources[0], type, what: describeRow(type, row), why: r.reason ?? 'not imported' })
    }
  }
  return out
}
