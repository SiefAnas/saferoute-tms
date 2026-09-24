import type { AbsentTodayEntry, DriverSession, Monitor, PublicUser, Trip } from '@/api/types'

// Pure helpers for the admin screens (mobile-admin-roles): no React Native, so jest runs them.

// "Is this timestamp today?" on the phone's own calendar day.
function sameLocalDay(iso: string, now: Date): boolean {
  const d = new Date(iso)
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

// Who is checked in right now: drivers with an open session, then monitors with one. Only
// active accounts. Each entry says since when and which shift, for the dashboard list.
export interface OnShiftEntry {
  id: string
  name: string
  phone: string | null
  role: 'driver' | 'monitor'
  since: string
  shift: 'morning' | 'afternoon' | null
  ridesWith: string | null
}

export function whoIsCheckedIn(drivers: PublicUser[], sessions: DriverSession[], monitors: Monitor[]): OnShiftEntry[] {
  const open = new Map<string, DriverSession>()
  for (const s of sessions) if (s.check_out_at === null) open.set(s.user_id, s)
  const list: OnShiftEntry[] = []
  for (const d of drivers) {
    const s = open.get(d.id)
    if (d.is_active && s) list.push({ id: d.id, name: d.full_name, phone: d.phone, role: 'driver', since: s.check_in_at, shift: s.shift_period, ridesWith: null })
  }
  for (const m of monitors) {
    if (m.is_active && m.open_session) {
      list.push({
        id: m.id,
        name: m.full_name,
        phone: m.phone,
        role: 'monitor',
        since: m.open_session.check_in_at,
        shift: m.open_session.shift_period,
        ridesWith: m.assignment?.driver_name ?? null,
      })
    }
  }
  return list
}

// A school's trips for today: anything created today, plus older trips still waiting on the
// school (so nothing pending is ever hidden). Waiting first, newest first.
export function todaysTrips(trips: Trip[], now: Date = new Date()): Trip[] {
  return trips
    .filter((t) => sameLocalDay(t.created_at, now) || t.status === 'pending')
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.created_at.localeCompare(a.created_at))
}

export function absentLabel(e: AbsentTodayEntry): string {
  return e.type === 'parent_skipped' ? 'Parent skipped' : 'No-show'
}

// Case-insensitive "contains" across a few fields, for the list search boxes.
export function matches(q: string, ...fields: (string | null | undefined)[]): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  return fields.some((f) => f?.toLowerCase().includes(needle))
}

// The website pages the app links to for everything it doesn't do itself.
export const WEBSITE_PAGES = {
  dashboard: '/company',
  drivers: '/company/drivers',
  monitors: '/company/monitors',
  fleet: '/company/vans',
  assignments: '/company/assignments',
  students: '/company/students',
  parents: '/company/parents',
  payroll: '/company/payroll',
  companyProfile: '/company/profile',
  schoolStudents: '/school-admin',
  schoolPickup: '/school-admin/pickup',
  staffAccess: '/school-admin/staff',
  schoolProfile: '/school-admin/profile',
  staffPickup: '/school-staff',
} as const

export function websiteUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

// Does this assignment run today? In its date range (dates compared as "YYYY-MM-DD" text) and
// on today's ISO weekday. `today` is the phone's local date, `isoDow` 1 = Monday ... 7 = Sunday.
export function runsOn(a: { start_date: string; end_date: string | null; days_of_week?: number[] }, today: string, isoDow: number): boolean {
  if (a.start_date.slice(0, 10) > today) return false
  if (a.end_date && a.end_date.slice(0, 10) < today) return false
  return (a.days_of_week ?? [1, 2, 3, 4, 5]).includes(isoDow)
}
