// Invented spreadsheets with the SHAPE of real customer route files (multi-file import tests).
// Every name, address and phone number here is made up. Never put a real customer file, or a
// real child's details, in this repo: it is public.
import type { ImportTypeDef, KnownDriver, KnownVan, ParseContext } from '../../src/lib/sheetParse.ts'

const f = (key: string, label: string, required = false) => ({ key, label, required })

// The company-admin import types, as GET /imports/types returns them (keys and labels).
export const TYPES: ImportTypeDef[] = [
  { id: 'schools', label: 'Schools', fields: [f('name', 'School name', true), f('address', 'Address', true), f('state', 'State (2 letters)'), f('zip_code', 'Zip code'), f('phone', 'Phone'), f('hours', 'Hours'), f('website', 'Website')] },
  { id: 'drivers', label: 'Drivers', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone'), f('address', 'Address'), f('license_number', 'License number')] },
  { id: 'monitors', label: 'Monitors', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone'), f('address', 'Address')] },
  { id: 'parents', label: 'Parents', fields: [f('full_name', 'Full name', true), f('email', 'Email', true), f('phone', 'Phone', true), f('address', 'Address', true)] },
  { id: 'vans', label: 'Vans', fields: [f('license_plate', 'License plate', true), f('brand', 'Brand', true), f('model', 'Model', true), f('year', 'Year', true), f('color', 'Color', true), f('number', 'Van number')] },
  { id: 'students', label: 'Students', fields: [f('full_name', 'Student name', true), f('school', 'School (exact name)', true), f('student_id', 'Student ID'), f('grade', 'Grade', true), f('age', 'Age', true), f('parent_name', 'Parent name', true), f('parent_phone', 'Parent phone', true), f('parent_email', 'Parent email'), f('street_address', 'Street address', true), f('city', 'City', true), f('state', 'State (2 letters)', true), f('zip_code', 'Zip code', true), f('notes', 'Notes')] },
  { id: 'assignments', label: 'Assignments', fields: [f('student_name', 'Student name', true), f('school', 'School (exact name)', true), f('student_id', 'Student ID'), f('driver_email', 'Driver email', true), f('van_plate', 'Van license plate', true), f('start_date', 'Start date', true), f('end_date', 'End date'), f('pickup_time', 'Pickup time'), f('dropoff_time', 'Dropoff time'), f('shift_period', 'Shift (morning/afternoon/both)'), f('days_of_week', 'Days')] },
]

const driver = (n: number, full_name: string): KnownDriver => ({ id: `d${n}`, full_name, email: `${full_name.split(' ')[0].toLowerCase()}@example.test` })

// Shape A drivers (one sheet each, named by first name) and shape B drivers.
export const DRIVERS_A = ['Avery Stone', 'Blake Rivera', 'Casey Moore', 'Dana Fox', 'Eden Hale', 'Finn Cruz', 'Gale Ortiz', 'Harper Lane'].map((n, i) => driver(i + 1, n))
export const DRIVERS_B = ['Iris Dunn', 'Jonah Webb', 'Kira Lowe', 'Liam Shaw'].map((n, i) => driver(i + 11, n))
export const VANS: KnownVan[] = [1, 2, 3, 4, 5].map((n) => ({ id: `v${n}`, license_plate: `TST-10${n}`, number: String(n) }))

export function context(drivers: KnownDriver[] = [...DRIVERS_A, ...DRIVERS_B]): ParseContext {
  // Shape A has no van column: each driver's van today comes from their current assignment.
  const driverVan = Object.fromEntries(drivers.map((d, i) => [d.id, VANS[i % VANS.length].license_plate]))
  return { types: TYPES, drivers, vans: VANS, driverVan }
}

const SCHOOL_ADDR: Record<string, string> = {
  CHS: '100 Test High Rd, Canton, MA 02021', GMS: '20 Fake Middle St, Canton, MA 02021',
  JFK: '5 Sample Ave, Canton, MA 02021', HAN: '77 Example Way, Canton, MA 02021',
  QHS: '1 Pretend Blvd, Quincy, MA 02169', GOAL: '9 Made Up Ln, Quincy, MA 02169',
}

// ---- Shape A, "Canton style" ------------------------------------------------------------------------
// Header on row 1. No van column. The Driver column is mostly blank; where filled it holds a
// driver, a shift, an accommodation, or a driver plus a shift. Bare day notes under a student.
const A_HEADER = ['School', 'Student Name', 'School Address', 'Drop Off', 'Pick Up', 'Student Address', 'Phone', 'Driver']
const aRow = (school: string, name: string, drop: string, pick: string, home: string, phone: string, drv = '') => [school, name, SCHOOL_ADDR[school], drop, pick, home, phone, drv]
const BLANK_A = A_HEADER.map(() => '')

export function shapeA(): Record<string, string[][]> {
  const sheets: Record<string, string[][]> = {}
  const first = DRIVERS_A.map((d) => d.full_name.split(' ')[0])
  first.forEach((name, i) => {
    sheets[name] = [A_HEADER,
      aRow('GMS', `Pupil ${name} One`, '2:45 PM', '7:10 AM', `${10 + i} Elm St, Canton, MA 02021`, `(555) 010-${String(1000 + i).slice(-4)}`),
      aRow('JFK', `Pupil ${name} Two`, '3:05 PM', '7:25 AM', `${20 + i} Oak Ave, Canton, MA 02021`, `555-010-${String(2000 + i).slice(-4)}`),
      BLANK_A,
    ]
  })
  // Avery: a shift, an accommodation and a monitor in the Driver column; a day note; the shared student.
  sheets.Avery.push(
    aRow('CHS', 'Mila Testa', '2:30 PM', '', '3 Birch Rd, Canton, MA 02021', '555-010-3001', 'Afternoon Only'),
    aRow('CHS', 'Noah Sample', '2:30 PM', '7:00 AM', '4 Birch Rd, Canton, MA 02021', '555-010-3002', 'Booster Seat'),
    aRow('HAN', 'Omar Fiction', '2:50 PM', '7:05 AM', '5 Birch Rd, Canton, MA 02021', '555-010-3003', 'Monitor'),
    ['', 'M/W/Th', '', '', '', '', '', ''],
    BLANK_A,
    aRow('CHS', 'Leo Shared', '2:30 PM', '7:00 AM', '8 Cedar Ct, Canton, MA 02021', '555-010-4000'),
  )
  // Blake and Casey also carry the shared student (three sheets, once per shift).
  sheets.Blake.push(aRow('CHS', 'Leo Shared', '', '7:00 AM', '8 Cedar Ct, Canton, MA 02021', '555-010-4000', 'Morning Only'))
  sheets.Casey.push(
    aRow('CHS', 'Leo Shared', '2:30 PM', '', '8 Cedar Ct, Canton, MA 02021', '555-010-4000', 'Afternoon Only'),
    aRow('GMS', 'Pia Notreal', '2:45 PM', '7:10 AM', '9 Cedar Ct, Canton, MA 02021', '555-010-4001', 'Blake Morning'),
    ['', 'Tuesday/Friday', '', '', '', '', '', ''],
  )
  return sheets
}

// ---- Shape B, "Quincy style" ------------------------------------------------------------------------
// Two junk rows, header on row 3, an unnamed van column, one sheet with an unnamed grade column,
// times holding shifts, a school-named sheet, a sheet with two header rows that repeats another
// sheet's students, and trailing note rows.
const B_HEADER = ['School', 'Student Name', 'School Address', 'Drop Off', 'Pick Up', 'Student Address', 'Student Number', '', 'Notes/Accommodations', 'Monitor', 'Driver']
const JUNK = [['Dispatch: Pat Placeholder', '', '', ''], ['(555) 010-9000', '', '', '']]
const bRow = (school: string, name: string, drop: string, pick: string, home: string, num: string, van: string, notes = '', mon = '', drv = '') =>
  [school, name, SCHOOL_ADDR[school], drop, pick, home, num, van, notes, mon, drv]

export function shapeB(): Record<string, string[][]> {
  const iris = [
    bRow('QHS', 'Quinn Madeup', '2:15 PM', '6:55 AM', '11 Maple St, Quincy, MA 02169', 'Q-1001', 'Van 1', '', 'No'),
    bRow('QHS', 'Rory Invent', 'Afternoon', '6:55 AM', '12 Maple St, Quincy, MA 02169', 'Q-1002', 'Van 1', 'Car seat', 'Yes'),
    bRow('QHS', 'Sage Unreal', '2:15 PM', 'Morning Only', '13 Maple St, Quincy, MA 02169', 'Q-1003', 'Van 1'),
  ]
  return {
    Iris: [...JUNK, B_HEADER, ...iris, ['Note: Wednesday Early Release at 12:30']],
    Jonah: [...JUNK, [...B_HEADER, ''],
      [...bRow('QHS', 'Tess Pretend', '2:15 PM', '7:00 AM', '21 Pine St, Quincy, MA 02169', 'Q-2001', 'Van 2'), 'Grade 10'],
      [...bRow('QHS', 'Uma Fakename', '2:15 PM', '7:00 AM', '22 Pine St, Quincy, MA 02169', 'Q-2002', 'Van 2'), 'Grade 8'],
      [...bRow('GOAL', 'Vic Nobody', '1:30 PM', '7:30 AM', '23 Pine St, Quincy, MA 02169', 'Q-2003', 'Van 2'), 'Grade 7'],
    ],
    // Two header rows, and Iris's three students again (same driver: a copy of her sheet).
    Kira: [...JUNK, B_HEADER, bRow('QHS', 'Wren Imagined', '2:20 PM', '7:05 AM', '31 Ash St, Quincy, MA 02169', 'Q-3001', 'Van 3'),
      [], B_HEADER, ...iris.map((r) => [...r.slice(0, 10), 'Iris Dunn'])],
    Liam: [...JUNK, B_HEADER, bRow('QHS', 'Xan Storybook', '2:25 PM', '7:10 AM', '41 Elm St, Quincy, MA 02169', 'Q-4001', 'Van 4')],
    // Named after a school, not a driver: one row names its driver, one doesn't.
    GOAL: [...JUNK, B_HEADER,
      bRow('GOAL', 'Yara Pretendson', '1:30 PM', '7:30 AM', '51 Oak St, Quincy, MA 02169', 'Q-5001', 'Van 5', '', '', 'Liam Shaw'),
      bRow('GOAL', 'Zed Nonexistent', '1:30 PM', '7:30 AM', '52 Oak St, Quincy, MA 02169', 'Q-5002', 'Van 5'),
      ['Note: GOAL dismisses at 1:15 on Fridays'],
    ],
  }
}

// A sheet nothing can be made of.
export const JUNK_SHEET = [['Totals for October'], ['42'], [''], ['see attached']]
