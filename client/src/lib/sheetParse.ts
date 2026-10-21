// Reading spreadsheets the way companies actually keep them (multi-file import). Pure functions on
// plain grids of text, no React and no SheetJS, so they run in a Node unit test. Plain rules only:
// no model calls, nothing leaves the browser. Every guess carries { value, confidence, reason } so
// a review screen can show why.
//
//   1. findHeaderRow   the real header row in the first 10 rows (junk rows above it are skipped)
//   2. classifySheet   what the sheet is: a route sheet (students per driver), or one import type
//   3. mapColumns      each column to a field: by name and synonyms, then by what the cells hold
//   4-7. parseRouteSheet  junk and note rows, the driver from the sheet name, multi-value Driver /
//                      time cells, and a student line per row (made into rows in importPlan.ts)

export interface Guess<T> {
  value: T
  confidence: number // 0..1
  reason: string // a plain sentence, shown to the admin
}

// One sheet as read from the file: every row as text, blank rows included, so line numbers hold.
export interface RawSheet {
  file: string
  name: string
  rows: string[][]
  firstLine: number // the spreadsheet line number of rows[0]
}

export interface ImportFieldDef { key: string; label: string; required: boolean }
export interface ImportTypeDef { id: string; label: string; fields: ImportFieldDef[] }
export interface KnownDriver { id: string; full_name: string; email: string }
export interface KnownVan { id: string; license_plate: string; number: string | null }

// What the company already has, for matching names in the file to real records.
export interface ParseContext {
  types: ImportTypeDef[]
  drivers: KnownDriver[]
  vans: KnownVan[]
  driverVan: Record<string, string> // driver id -> license plate of the van they drive today
}

export type SheetKind = 'route' | 'schools' | 'drivers' | 'monitors' | 'parents' | 'vans' | 'students' | 'assignments' | 'staff' | 'unreadable'

export const KIND_LABEL: Record<SheetKind, string> = {
  route: 'Route sheet', schools: 'Schools', drivers: 'Drivers', monitors: 'Monitors', parents: 'Parents', vans: 'Vans',
  students: 'Students', assignments: 'Assignments', staff: 'School staff', unreadable: 'Unreadable',
}

export const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

// The page's original column matcher (header == field key or label), kept as the first rule.
export const sameName = (header: string, f: { key: string; label: string }) => Boolean(header) && (norm(header) === norm(f.key) || norm(header) === norm(f.label))

// ---- vocabulary -----------------------------------------------------------------------------------

// Route-sheet columns. Each lists the header spellings it answers to (normalized).
export type RouteRole =
  | 'school' | 'school_address' | 'student_name' | 'student_id' | 'student_address' | 'phone' | 'pickup' | 'dropoff'
  | 'driver' | 'van' | 'grade' | 'notes' | 'monitor' | 'days' | 'parent_name' | 'parent_email' | 'age'

const PHONE_WORDS = ['phone', 'cell', 'cellnumber', 'phonenumber', 'contact', 'contactnumber', 'mobile', 'telephone', 'tel', 'parentphone', 'parentcell']

export const ROUTE_SYNONYMS: Record<RouteRole, string[]> = {
  school: ['school', 'schoolname', 'sch'],
  school_address: ['schooladdress', 'schooladdr', 'schoollocation'],
  student_name: ['studentname', 'student', 'studentsname', 'pupil', 'child', 'childname', 'rider', 'ridername', 'name', 'fullname'],
  student_id: ['studentnumber', 'studentid', 'studentno', 'id', 'idnumber'],
  student_address: ['studentaddress', 'homeaddress', 'address', 'pickupaddress', 'streetaddress'],
  phone: PHONE_WORDS,
  pickup: ['pickup', 'pickuptime', 'pu', 'putime', 'amtime'],
  dropoff: ['dropoff', 'dropofftime', 'do', 'dotime', 'pmtime'],
  driver: ['driver', 'drivername'],
  van: ['van', 'vannumber', 'vanno', 'vehicle', 'bus', 'busnumber'],
  grade: ['grade', 'gr', 'gradelevel'],
  notes: ['notes', 'note', 'notesaccommodations', 'accommodations', 'accommodation', 'comments', 'specialneeds'],
  monitor: ['monitor', 'aide', 'monitoraide'],
  days: ['days', 'daysofweek', 'schedule'],
  parent_name: ['parent', 'parentname', 'guardian', 'guardianname'],
  parent_email: ['parentemail', 'guardianemail'],
  age: ['age'],
}

// Extra header spellings for the import types' own fields (beyond key and label).
export const FIELD_SYNONYMS: Record<string, string[]> = {
  full_name: ['name', 'fullname', 'drivername', 'monitorname', 'parentname', 'studentname', 'student', 'pupil', 'child', 'rider'],
  student_name: ['studentname', 'student', 'name', 'pupil', 'child', 'rider'],
  email: ['email', 'emailaddress', 'mail'],
  phone: PHONE_WORDS,
  parent_phone: PHONE_WORDS,
  license_plate: ['plate', 'tag', 'reg', 'licenseplate', 'registration', 'plateno', 'platenumber'],
  van_plate: ['plate', 'tag', 'reg', 'licenseplate', 'vanplate'],
  number: ['van', 'vannumber', 'vanno', 'unit', 'unitnumber'],
  name: ['school', 'schoolname', 'name'],
  address: ['address', 'schooladdress', 'streetaddress'],
  street_address: ['address', 'streetaddress', 'studentaddress', 'homeaddress'],
  driver_email: ['driveremail', 'driver'],
  student_id: ['studentnumber', 'studentid', 'studentno', 'id'],
  zip_code: ['zip', 'zipcode', 'postalcode', 'postcode'],
  license_number: ['license', 'licensenumber', 'driverslicense', 'licenseno'],
}

// Words that make a cell look like a column label (header row scoring).
const LABEL_WORDS = ['student', 'name', 'school', 'address', 'phone', 'cell', 'driver', 'van', 'pickup', 'dropoff', 'grade', 'monitor', 'notes', 'accommodation', 'time', 'email', 'plate', 'contact', 'parent', 'zip', 'city', 'state', 'model', 'brand', 'color', 'year', 'days', 'number']

// ---- value recognizers ----------------------------------------------------------------------------

export const isBlank = (s: string | undefined) => !s || !String(s).trim()

const VAN_RE = /^(?:van\s*#?\s*(\d{1,4})|#\s*(\d{1,4}))$/i
export function vanNumberOf(s: string): string | null {
  const m = VAN_RE.exec(s.trim())
  return m ? (m[1] ?? m[2]) : null
}

export function isPhone(s: string) {
  const t = s.trim()
  if (!/^[\d\s().+-]+(?:\s*(?:x|ext\.?)\s*\d+)?$/i.test(t)) return false
  const digits = t.replace(/(?:x|ext\.?)\s*\d+$/i, '').replace(/\D/g, '')
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))
}

// '7:30', '07:30', '7:30:00', '2:45 PM', '2:45pm' -> 'HH:MM' (24-hour), or null.
export function parseTime(s: string): string | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?$/i.exec(s.trim())
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2])
  const ap = m[4]?.toLowerCase()
  if (ap) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (ap === 'p' ? 12 : 0)
  }
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const GRADE_RE = /^(?:(?:grade|gr\.?)\s*(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)(?:\s*grade)?|(pk|pre-?k|k|kindergarten))$/i
export function gradeOf(s: string): string | null {
  const m = GRADE_RE.exec(s.trim())
  if (!m) return null
  if (m[1] ?? m[2]) return String(Number(m[1] ?? m[2]))
  return /^p/i.test(m[3]!) ? 'PK' : 'K'
}

export const isYesNo = (s: string) => /^(y|n|yes|no|true|false|x)$/i.test(s.trim())
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim())
export const isAddress = (s: string) => /^\d+[a-z]?\s+[a-z0-9.'#-]+(?:\s+[a-z0-9.,'#-]+)*$/i.test(s.trim()) && /[a-z]{2,}/i.test(s)
export const isPlate = (s: string) => /^[A-Z0-9]{1,4}[- ]?[A-Z0-9]{1,5}$/i.test(s.trim()) && /\d/.test(s) && /[a-z]/i.test(s)

// 'M/W/Th', 'Tuesday/Friday', 'Mon, Wed' -> [1,3,4] (ISO weekdays), or null if any part isn't a day.
const DAY_TOKENS: Record<string, number> = {
  m: 1, mo: 1, mon: 1, monday: 1, t: 2, tu: 2, tue: 2, tues: 2, tuesday: 2, w: 3, we: 3, wed: 3, weds: 3, wednesday: 3,
  th: 4, r: 4, thu: 4, thur: 4, thurs: 4, thursday: 4, f: 5, fr: 5, fri: 5, friday: 5,
  sa: 6, sat: 6, saturday: 6, su: 7, sun: 7, sunday: 7,
}
export function parseDayList(s: string): number[] | null {
  const parts = s.trim().toLowerCase().split(/[\s,;/&+-]+|\band\b/).filter(Boolean)
  if (!parts.length) return null
  const days: number[] = []
  for (const p of parts) {
    const d = DAY_TOKENS[p.replace(/\.$/, '')] ?? (/^[1-7]$/.test(p) ? Number(p) : undefined)
    if (!d) return null
    if (!days.includes(d)) days.push(d)
  }
  return days.sort((a, b) => a - b)
}

export type Shift = 'morning' | 'afternoon' | 'both'
// The shift a cell names ('Afternoon Only', 'AM', 'Jerry Morning'), and the text left over.
export function shiftIn(s: string): { shift: Shift; rest: string } | null {
  const am = /\b(morning|a\.?m\.?)(?=\W|$)/i.test(s)
  const pm = /\b(afternoon|p\.?m\.?)(?=\W|$)/i.test(s)
  if (!am && !pm) return null
  const rest = s.replace(/\b(morning|afternoon|a\.?m\.?|p\.?m\.?)(?=\W|$)/gi, ' ').replace(/\bonly\b/gi, ' ').replace(/[()\-,/]+/g, ' ').replace(/\s+/g, ' ').trim()
  return { shift: am && pm ? 'both' : am ? 'morning' : 'afternoon', rest }
}

const ACCOMMODATION_RE = /\b(booster|car\s*seat|carseat|monitor|walker|wheelchair|separate|harness|seat\s*belt|buckle|aide)\b/i

// A known driver by full name, or by a first or last name only one driver has.
export function matchDriver(text: string, drivers: KnownDriver[]): Guess<KnownDriver> | null {
  const n = norm(text)
  if (!n) return null
  const full = drivers.filter((d) => norm(d.full_name) === n)
  if (full.length === 1) return { value: full[0], confidence: 0.95, reason: `"${text}" is the name of your driver ${full[0].full_name}` }
  const parts = (d: KnownDriver) => d.full_name.trim().split(/\s+/)
  const first = drivers.filter((d) => norm(parts(d)[0]) === n)
  if (first.length === 1) return { value: first[0], confidence: 0.8, reason: `"${text}" matches the first name of your only driver called ${first[0].full_name}` }
  const last = drivers.filter((d) => parts(d).length > 1 && norm(parts(d)[parts(d).length - 1]) === n)
  if (last.length === 1) return { value: last[0], confidence: 0.7, reason: `"${text}" matches the last name of your only driver called ${last[0].full_name}` }
  return null
}

// ---- step 1: header row ---------------------------------------------------------------------------

export const HEADER_SCAN_ROWS = 10
export const HEADER_MIN_SCORE = 2

const allSynonyms = new Set([...Object.values(ROUTE_SYNONYMS).flat(), ...Object.values(FIELD_SYNONYMS).flat()])
function labelScore(cells: string[]) {
  return cells.filter((c) => {
    const n = norm(c)
    if (!n || n.length > 40) return false
    return allSynonyms.has(n) || LABEL_WORDS.some((w) => n.includes(w))
  }).length
}

export function findHeaderRow(rows: string[][]): Guess<number> | null {
  let best = -1
  let bestScore = 0
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rows.length); i++) {
    const s = labelScore(rows[i] ?? [])
    if (s > bestScore) { best = i; bestScore = s }
  }
  if (bestScore < HEADER_MIN_SCORE) return null
  const filled = (rows[best] ?? []).filter((c) => !isBlank(c)).length
  const skipped = best === 0 ? '' : `, after ${best} row${best === 1 ? '' : 's'} above it that are not column names`
  return { value: best, confidence: Math.min(0.95, 0.5 + bestScore / Math.max(filled, 1) / 2), reason: `${bestScore} of its ${filled} cells look like column names${skipped}` }
}

// ---- step 3: columns ------------------------------------------------------------------------------

export interface ColumnGuess {
  index: number
  header: string
  target: string | null // a RouteRole on a route sheet, else the import type's field key
  confidence: number
  reason: string
}

const columnValues = (data: string[][], c: number) => data.map((r) => String(r[c] ?? '').trim()).filter(Boolean)

// What the cells of an unnamed (or unrecognized) column hold, by majority.
type ContentKind = 'van' | 'phone' | 'time' | 'grade' | 'yesno' | 'address' | 'driver' | 'email' | 'plate'
function contentOf(values: string[], drivers: KnownDriver[]): { kind: ContentKind; hits: number } | null {
  if (values.length < 2) return null
  const tests: [ContentKind, (v: string) => boolean][] = [
    ['van', (v) => vanNumberOf(v) !== null],
    ['email', isEmail],
    ['phone', isPhone],
    ['time', (v) => parseTime(v) !== null],
    ['grade', (v) => gradeOf(v) !== null],
    ['yesno', isYesNo],
    ['address', isAddress],
    ['driver', (v) => matchDriver(v, drivers) !== null],
    ['plate', isPlate],
  ]
  let best: { kind: ContentKind; hits: number } | null = null
  for (const [kind, test] of tests) {
    const hits = values.filter(test).length
    if (hits / values.length >= 0.6 && (!best || hits > best.hits)) best = { kind, hits }
  }
  return best
}

const CONTENT_TEXT: Record<ContentKind, string> = {
  van: 'look like Van N', phone: 'look like phone numbers', time: 'look like times', grade: 'look like grades',
  yesno: 'are Yes or No', address: 'look like street addresses', driver: 'are names of your drivers', email: 'are email addresses', plate: 'look like license plates',
}

function headerText(h: string) {
  return isBlank(h) ? 'column had no header' : `header "${h}" is not one we know`
}

// Route sheets: header names first, then content for what is left. Pickup vs dropoff for an
// unnamed time column is decided by its neighbours.
export function mapRouteColumns(headers: string[], data: string[][], ctx: ParseContext): ColumnGuess[] {
  const width = Math.max(headers.length, ...data.map((r) => r.length))
  const out: ColumnGuess[] = []
  const taken = new Set<string>()
  for (let c = 0; c < width; c++) {
    const h = String(headers[c] ?? '').trim()
    const n = norm(h)
    let target: RouteRole | null = null
    for (const [role, words] of Object.entries(ROUTE_SYNONYMS) as [RouteRole, string[]][]) {
      if (words.includes(n) && !taken.has(role)) { target = role; break }
    }
    // "Notes/Accommodations", "Pick Up Time (AM)": a header that contains a known word.
    if (!target && n) {
      const contains: [RouteRole, RegExp][] = [['school_address', /school.*addr/], ['student_address', /addr/], ['pickup', /pickup/], ['dropoff', /dropoff/], ['notes', /note|accommodat/], ['phone', /phone|cell/], ['student_name', /student/], ['monitor', /monitor/], ['driver', /driver/], ['grade', /grade/]]
      for (const [role, re] of contains) if (re.test(n) && !taken.has(role)) { target = role; break }
    }
    if (target) {
      taken.add(target)
      out.push({ index: c, header: h, target, confidence: ROUTE_SYNONYMS[target].includes(n) ? 0.9 : 0.75, reason: `header "${h}" means ${target.replace('_', ' ')}` })
    } else out.push({ index: c, header: h, target: null, confidence: 0, reason: '' })
  }
  for (const col of out) {
    if (col.target) continue
    const values = columnValues(data, col.index)
    if (!values.length) { col.reason = `${headerText(col.header)} and is empty`; continue }
    const hit = contentOf(values, ctx.drivers)
    const of = hit ? `${hit.hits} of ${values.length} values ${CONTENT_TEXT[hit.kind]}` : ''
    let role: RouteRole | null = null
    if (hit?.kind === 'van') role = 'van'
    else if (hit?.kind === 'phone') role = 'phone'
    else if (hit?.kind === 'grade') role = 'grade'
    else if (hit?.kind === 'driver') role = 'driver'
    else if (hit?.kind === 'email') role = 'parent_email'
    else if (hit?.kind === 'yesno' && /monitor|aide/i.test(col.header)) role = 'monitor'
    else if (hit?.kind === 'address') role = taken.has('student_address') ? 'school_address' : 'student_address'
    else if (hit?.kind === 'time') {
      const left = out.find((o) => o.index === col.index - 1)?.target
      const right = out.find((o) => o.index === col.index + 1)?.target
      role = left === 'pickup' || right === 'pickup' ? 'dropoff' : left === 'dropoff' || right === 'dropoff' ? 'pickup' : !taken.has('pickup') ? 'pickup' : 'dropoff'
    }
    if (role && !taken.has(role)) {
      taken.add(role)
      Object.assign(col, { target: role, confidence: Math.min(0.85, 0.4 + (hit!.hits / values.length) * 0.45), reason: `${headerText(col.header)}, ${of}` })
    } else {
      col.reason = hit ? `${headerText(col.header)}; ${of}, but that is already read from another column` : `${headerText(col.header)}, and its values don't look like anything we use`
    }
  }
  return out
}

// Typed sheets: the import type's own fields, by name (the page's original matcher), synonyms,
// then content (emails, phones, plates, van numbers).
export function mapTypedColumns(type: ImportTypeDef, headers: string[], data: string[][], ctx: ParseContext): ColumnGuess[] {
  const width = Math.max(headers.length, ...data.map((r) => r.length))
  const out: ColumnGuess[] = []
  const taken = new Set<string>()
  for (let c = 0; c < width; c++) {
    const h = String(headers[c] ?? '').trim()
    let f = type.fields.find((fd) => !taken.has(fd.key) && sameName(h, fd))
    let conf = 0.95
    let why = `header "${h}" is the ${f?.label} column`
    if (!f) {
      f = type.fields.find((fd) => !taken.has(fd.key) && (FIELD_SYNONYMS[fd.key] ?? []).includes(norm(h)))
      conf = 0.85
      why = `header "${h}" is another name for ${f?.label}`
    }
    if (f) { taken.add(f.key); out.push({ index: c, header: h, target: f.key, confidence: conf, reason: why }) }
    else out.push({ index: c, header: h, target: null, confidence: 0, reason: '' })
  }
  const byContent: Partial<Record<ContentKind, string[]>> = {
    email: ['email', 'driver_email', 'parent_email'], phone: ['phone', 'parent_phone'], plate: ['license_plate', 'van_plate'], van: ['number'],
    time: ['pickup_time'], grade: ['grade'], address: ['address', 'street_address'],
  }
  for (const col of out) {
    if (col.target) continue
    const values = columnValues(data, col.index)
    const hit = values.length ? contentOf(values, ctx.drivers) : null
    const key = hit ? (byContent[hit.kind] ?? []).find((k) => type.fields.some((fd) => fd.key === k) && !taken.has(k)) : undefined
    if (hit && key) {
      taken.add(key)
      Object.assign(col, { target: key, confidence: Math.min(0.85, 0.4 + (hit.hits / values.length) * 0.45), reason: `${headerText(col.header)}, ${hit.hits} of ${values.length} values ${CONTENT_TEXT[hit.kind]}` })
    } else col.reason = values.length ? `${headerText(col.header)}, and it is not used for ${type.label.toLowerCase()}` : `${headerText(col.header)} and is empty`
  }
  return out
}

// ---- step 2: what the sheet is --------------------------------------------------------------------

export function classifySheet(sheetName: string, headers: string[], data: string[][], ctx: ParseContext): Guess<SheetKind> {
  const route = mapRouteColumns(headers, data, ctx)
  const has = (r: RouteRole) => route.some((c) => c.target === r)
  const n = headers.map(norm)
  const any = (...words: string[]) => n.some((h) => words.some((w) => h.includes(w)))
  const sheetDriver = matchDriver(sheetName, ctx.drivers)
  const types = new Set(ctx.types.map((t) => t.id))
  const pick = (kind: SheetKind, confidence: number, reason: string): Guess<SheetKind> =>
    (kind === 'route' || types.has(kind) ? { value: kind, confidence, reason } : { value: 'unreadable', confidence: 0.3, reason: `${reason}, but your account cannot import ${KIND_LABEL[kind].toLowerCase()}` })

  if (any('driveremail', 'vanplate', 'licenseplate') && has('student_name')) return pick('assignments', 0.8, 'it has students with a driver email and a van plate, like the Assignments template')
  if (has('student_name') && has('school')) {
    const routeish = has('driver') || has('van') || has('pickup') || has('dropoff') || Boolean(sheetDriver)
    if (routeish) return pick('route', 0.9, `it has Student Name and School columns${has('driver') ? ' and a Driver column' : has('pickup') || has('dropoff') ? ' with pickup or drop off times' : ''}`)
    return pick('students', 0.75, 'it has Student Name and School columns but no driver, van or times')
  }
  const emails = route.some((c) => isEmail(columnValues(data, c.index)[0] ?? '')) || any('email')
  if (emails && !has('student_name')) {
    const sn = norm(sheetName)
    if (sn.includes('monitor') || any('monitor')) return pick('monitors', 0.7, 'it lists names and emails, and its name or headers say monitor')
    if (sn.includes('parent') || any('parent')) return pick('parents', 0.7, 'it lists names and emails, and its name or headers say parent')
    if (sn.includes('staff')) return pick('staff', 0.7, 'it lists names and emails, and its name says staff')
    return pick('drivers', 0.6, 'it lists names and emails with no students; drivers is the usual case')
  }
  const vanCol = route.find((c) => c.target === 'van')
  if (any('plate', 'tag') || (vanCol && !has('student_name'))) return pick('vans', 0.75, any('plate', 'tag') ? 'it has a license plate column and no students' : 'it has a Van N column and no students')
  if (has('school') && (has('school_address') || has('student_address')) && !has('student_name')) return pick('schools', 0.75, 'it has school names and addresses and no students')
  return { value: 'unreadable', confidence: 0.2, reason: 'its columns don\'t match a route sheet or any import type' }
}

// ---- steps 4-6: a route sheet, line by line --------------------------------------------------------

export interface SourceRef { file: string; sheet: string; line: number }

// One student on one route sheet: their student fields and the assignment this sheet gives them.
export interface RouteLine {
  source: SourceRef
  student: Record<string, Guess<string>> // full_name, school, student_id, grade, parent_phone, street_address, city, state, zip_code, parent_name, parent_email, age
  schoolAddress: Guess<string> | null
  driver: Guess<KnownDriver> | null
  van: Guess<string> | null // van number or plate as written, resolved in importPlan
  shift: Guess<Shift> | null
  pickup: Guess<string> | null
  dropoff: Guess<string> | null
  days: Guess<number[]> | null
  monitor: Guess<boolean> | null
  notes: { text: string; reason: string }[]
  problems: string[] // why the assignment can't be made from this line as it stands
}

export interface IgnoredRow { line: number; reason: string }

export interface ParsedSheet {
  file: string
  sheet: string
  kind: Guess<SheetKind>
  header: Guess<number> | null
  columns: ColumnGuess[]
  sheetDriver: Guess<KnownDriver> | null // route sheets: who the sheet name says drives it
  problems: string[] // sheet-level, e.g. "could not tell who drives this sheet"
  lines: RouteLine[] // route sheets
  records: { source: SourceRef; row: Record<string, string> }[] // typed sheets: rows keyed by field
  ignored: IgnoredRow[]
  notes: { source: SourceRef; text: string }[] // note rows with no student to attach to
}

// '12 Oak St, Quincy, MA 02169' -> street, city, state, zip. Anything else stays in the street.
export function splitAddress(s: string): { street: string; city: string; state: string; zip: string } {
  const m = /^(.+?),\s*([^,]+?),?\s+([A-Za-z]{2})\.?,?\s+(\d{5}(?:-\d{4})?)$/.exec(s.trim())
  if (m) return { street: m[1].trim(), city: m[2].trim(), state: m[3].toUpperCase(), zip: m[4] }
  const n = /^(.+?),\s*([^,]+?),\s*([A-Za-z]{2})$/.exec(s.trim())
  if (n) return { street: n[1].trim(), city: n[2].trim(), state: n[3].toUpperCase(), zip: '' }
  return { street: s.trim(), city: '', state: '', zip: '' }
}

const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length
// A cell that reads as a remark rather than a value: "Note: ...", or a sentence.
const looksLikeNote = (s: string) => /^(note|nb|n\.b\.|reminder|fyi)\b/i.test(s.trim()) || /:\s/.test(s) || wordCount(s) >= 4

// One Driver-column cell, which may hold a driver, a shift, an accommodation, or a mix.
export function readDriverCell(text: string, drivers: KnownDriver[]): Pick<RouteLine, 'driver' | 'shift' | 'monitor' | 'notes'> {
  const out: Pick<RouteLine, 'driver' | 'shift' | 'monitor' | 'notes'> = { driver: null, shift: null, monitor: null, notes: [] }
  const t = text.trim()
  const d = matchDriver(t, drivers)
  if (d) { out.driver = d; return out }
  const sh = shiftIn(t)
  if (sh) {
    out.shift = { value: sh.shift, confidence: 0.85, reason: `the Driver column says "${t}", which is a shift` }
    if (sh.rest) {
      const d2 = matchDriver(sh.rest, drivers)
      if (d2) out.driver = { ...d2, reason: `the Driver column says "${t}": ${d2.reason}, plus a shift` }
      else if (!ACCOMMODATION_RE.test(sh.rest)) out.notes.push({ text: t, reason: `the Driver column says "${t}"; the shift was read, "${sh.rest}" is not a driver we know` })
    }
    if (!sh.rest || !ACCOMMODATION_RE.test(sh.rest)) return out
  }
  if (ACCOMMODATION_RE.test(t)) {
    out.notes.push({ text: t, reason: `the Driver column says "${t}", which is an accommodation, not a driver` })
    if (/\b(monitor|aide)\b/i.test(t)) out.monitor = { value: true, confidence: 0.8, reason: `the Driver column says "${t}"` }
    return out
  }
  out.notes.push({ text: t, reason: `the Driver column says "${t}"; it is not a driver, shift or accommodation we know, so it was kept as a note` })
  return out
}

// A Pick Up / Drop Off cell: a time, or a shift written where the time goes ("Afternoon").
function readTimeCell(text: string, column: string): { time: Guess<string> | null; shift: Guess<Shift> | null; note: { text: string; reason: string } | null } {
  const t = text.trim()
  const time = parseTime(t)
  if (time) return { time: { value: time, confidence: 0.95, reason: `${column} is ${t}` }, shift: null, note: null }
  const sh = shiftIn(t)
  if (sh) return { time: null, shift: { value: sh.shift, confidence: 0.8, reason: `${column} says "${t}", which is a shift, not a time` }, note: null }
  return { time: null, shift: null, note: { text: `${column}: ${t}`, reason: `${column} says "${t}", which is not a time` } }
}

function rowIsHeaderAgain(row: string[], header: string[]) {
  const same = row.filter((c, i) => !isBlank(c) && norm(c) === norm(header[i] ?? '')).length
  return labelScore(row) >= HEADER_MIN_SCORE && same >= Math.max(2, Math.ceil(header.filter((h) => !isBlank(h)).length / 2))
}

export function parseRouteSheet(raw: RawSheet, headerIndex: number, columns: ColumnGuess[], ctx: ParseContext, out: ParsedSheet) {
  const col = (role: RouteRole) => columns.find((c) => c.target === role)?.index
  const header = raw.rows[headerIndex] ?? []
  const cell = (row: string[], role: RouteRole) => {
    const i = col(role)
    return i === undefined ? '' : String(row[i] ?? '').trim()
  }
  const nameCol = col('student_name')
  let last: RouteLine | null = null
  raw.rows.forEach((row, i) => {
    if (i <= headerIndex) return
    const line = raw.firstLine + i
    const source = { file: raw.file, sheet: raw.name, line }
    const filled = row.map((c, ci) => [ci, String(c ?? '').trim()] as const).filter(([, v]) => v)
    if (!filled.length) return // blank separator row
    if (rowIsHeaderAgain(row, header)) { out.ignored.push({ line, reason: 'a second header row' }); return }

    // A row with one cell is a remark about the row above: "M/W/Th" under a student, or
    // "Note: Wednesday Early Release at 12:30". Days are also read as the student's days.
    if (filled.length === 1) {
      const [ci, v] = filled[0]
      const days = parseDayList(v)
      if (days || ci !== nameCol || looksLikeNote(v)) {
        if (last) {
          last.notes.push({ text: v, reason: `line ${line} holds only "${v}", read as a note about the student above` })
          if (days && !last.days) last.days = { value: days, confidence: 0.7, reason: `line ${line} under this student says "${v}"` }
        } else out.notes.push({ source, text: v })
        return
      }
    }
    const name = cell(row, 'student_name')
    if (!name) { out.ignored.push({ line, reason: 'this row has no student name' }); return }

    const l: RouteLine = {
      source, student: {}, schoolAddress: null, driver: null, van: null, shift: null, pickup: null, dropoff: null, days: null, monitor: null, notes: [], problems: [],
    }
    const put = (key: string, value: string, reason: string, confidence = 0.9) => { if (value) l.student[key] = { value, confidence, reason } }
    put('full_name', name, 'from the student name column')
    put('school', cell(row, 'school'), 'from the school column')
    put('student_id', cell(row, 'student_id'), 'from the student number column')
    put('parent_name', cell(row, 'parent_name'), 'from the parent column')
    put('parent_email', cell(row, 'parent_email'), 'from the parent email column')
    put('age', cell(row, 'age'), 'from the age column')
    const phone = cell(row, 'phone')
    put('parent_phone', phone, 'from the phone column', isPhone(phone) ? 0.9 : 0.5)
    const grade = cell(row, 'grade')
    if (grade) put('grade', gradeOf(grade) ?? grade, `the grade column says "${grade}"`, gradeOf(grade) ? 0.9 : 0.5)
    const addr = cell(row, 'student_address')
    if (addr) {
      const a = splitAddress(addr)
      const split = Boolean(a.city)
      put('street_address', a.street, split ? `split from "${addr}"` : `"${addr}" could not be split into street, city, state and zip`, split ? 0.85 : 0.4)
      put('city', a.city, `split from "${addr}"`, 0.85)
      put('state', a.state, `split from "${addr}"`, 0.85)
      put('zip_code', a.zip, `split from "${addr}"`, 0.85)
    }
    const sa = cell(row, 'school_address')
    if (sa) l.schoolAddress = { value: sa, confidence: 0.9, reason: 'from the school address column' }

    // Driver column: driver, shift, accommodation or a mix. Blank: the sheet's driver.
    const dc = cell(row, 'driver')
    const read = dc ? readDriverCell(dc, ctx.drivers) : null
    if (read) {
      l.driver = read.driver
      l.shift = read.shift
      l.monitor = read.monitor
      l.notes.push(...read.notes)
    }
    if (!l.driver && out.sheetDriver) {
      l.driver = { value: out.sheetDriver.value, confidence: out.sheetDriver.confidence * 0.9, reason: `${dc ? 'the Driver column names no driver' : 'the Driver column is blank'}, so the sheet's driver: ${out.sheetDriver.reason}` }
    }
    // A Driver cell that was only a shift or an accommodation still leaves "who drives" open.
    if (!l.driver) l.problems.push(read && !read.shift && !ACCOMMODATION_RE.test(dc) ? `"${dc}" is not one of your drivers` : 'could not tell who drives this sheet')

    for (const [role, label] of [['pickup', 'Pick Up'], ['dropoff', 'Drop Off']] as const) {
      const v = cell(row, role)
      if (!v) continue
      const r = readTimeCell(v, label)
      if (r.time) l[role] = r.time
      if (r.note) l.notes.push(r.note)
      if (r.shift) l.shift = l.shift && l.shift.value !== r.shift.value ? { value: 'both', confidence: 0.5, reason: `${l.shift.reason}; and ${r.shift.reason}` } : (l.shift ?? r.shift)
    }

    const vc = cell(row, 'van')
    if (vc) l.van = { value: vc, confidence: vanNumberOf(vc) ? 0.85 : 0.6, reason: `the van column says "${vc}"` }
    const notes = cell(row, 'notes')
    if (notes) {
      l.notes.push({ text: notes, reason: 'from the notes column' })
      if (/\bmonitor\b/i.test(notes) && !l.monitor) l.monitor = { value: true, confidence: 0.7, reason: `the notes say "${notes}"` }
      const sh = shiftIn(notes)
      if (sh && !l.shift && /\bonly\b/i.test(notes)) l.shift = { value: sh.shift, confidence: 0.6, reason: `the notes say "${notes}"` }
    }
    const mc = cell(row, 'monitor')
    if (mc) {
      if (isYesNo(mc)) {
        const yes = /^(y|yes|true|x)$/i.test(mc)
        l.monitor = { value: yes, confidence: 0.85, reason: `the monitor column says "${mc}"` }
        if (yes) l.notes.push({ text: 'Needs a monitor', reason: `the monitor column says "${mc}"` })
      } else {
        l.monitor = { value: true, confidence: 0.7, reason: `the monitor column says "${mc}"` }
        l.notes.push({ text: `Monitor: ${mc}`, reason: `the monitor column says "${mc}"` })
      }
    }
    const days = cell(row, 'days')
    if (days) {
      const d = parseDayList(days)
      if (d) l.days = { value: d, confidence: 0.85, reason: `the days column says "${days}"` }
      else l.notes.push({ text: `Days: ${days}`, reason: `the days column says "${days}", which is not a list of weekdays` })
    }
    out.lines.push(l)
    last = l
  })
}

function parseTypedSheet(raw: RawSheet, headerIndex: number, columns: ColumnGuess[], type: ImportTypeDef, out: ParsedSheet) {
  const header = raw.rows[headerIndex] ?? []
  raw.rows.forEach((row, i) => {
    if (i <= headerIndex) return
    const line = raw.firstLine + i
    if (!row.some((c) => !isBlank(c))) return
    if (rowIsHeaderAgain(row, header)) { out.ignored.push({ line, reason: 'a second header row' }); return }
    const rec: Record<string, string> = {}
    for (const f of type.fields) {
      const c = columns.find((g) => g.target === f.key)
      rec[f.key] = c ? String(row[c.index] ?? '').trim() : ''
    }
    if (!Object.values(rec).some(Boolean)) { out.ignored.push({ line, reason: 'none of the columns we use has a value' }); return }
    const used = new Set(columns.filter((g) => g.target).map((g) => g.index))
    const filledUnused = row.filter((c, ci) => !isBlank(c) && !used.has(ci))
    if (filledUnused.length === 1 && Object.values(rec).filter(Boolean).length === 0) { out.notes.push({ source: { file: raw.file, sheet: raw.name, line }, text: filledUnused[0] }); return }
    out.records.push({ source: { file: raw.file, sheet: raw.name, line }, row: rec })
  })
}

// Everything about one sheet. `kindOverride` is the admin's correction from the page.
export function parseSheet(raw: RawSheet, ctx: ParseContext, kindOverride?: SheetKind): ParsedSheet {
  const out: ParsedSheet = { file: raw.file, sheet: raw.name, kind: { value: 'unreadable', confidence: 0, reason: '' }, header: null, columns: [], sheetDriver: null, problems: [], lines: [], records: [], ignored: [], notes: [] }
  out.header = findHeaderRow(raw.rows)
  if (!out.header) {
    out.kind = { value: 'unreadable', confidence: 0.9, reason: `none of the first ${HEADER_SCAN_ROWS} rows looks like a row of column names` }
    return out
  }
  const h = out.header.value
  for (let i = 0; i < h; i++) if (raw.rows[i]?.some((c) => !isBlank(c))) out.ignored.push({ line: raw.firstLine + i, reason: 'above the header row' })
  const headers = (raw.rows[h] ?? []).map((c) => String(c ?? '').trim())
  const data = raw.rows.slice(h + 1).filter((r) => r.some((c) => !isBlank(c)) && !rowIsHeaderAgain(r, headers))
  out.kind = kindOverride
    ? { value: kindOverride, confidence: 1, reason: 'you chose this' }
    : classifySheet(raw.name, headers, data, ctx)
  const kind = out.kind.value
  if (kind === 'unreadable') return out
  if (kind === 'route') {
    out.columns = mapRouteColumns(headers, data, ctx)
    out.sheetDriver = matchDriver(raw.name, ctx.drivers)
    if (out.sheetDriver) out.sheetDriver.reason = `the sheet is named "${raw.name}": ${out.sheetDriver.reason}`
    else out.problems.push(`could not tell who drives this sheet: "${raw.name}" is not the name of one of your drivers`)
    parseRouteSheet(raw, h, out.columns, ctx, out)
    return out
  }
  const type = ctx.types.find((t) => t.id === kind)
  if (!type) { out.kind = { value: 'unreadable', confidence: 1, reason: `your account cannot import ${KIND_LABEL[kind].toLowerCase()}` }; return out }
  out.columns = mapTypedColumns(type, headers, data, ctx)
  parseTypedSheet(raw, h, out.columns, type, out)
  return out
}
