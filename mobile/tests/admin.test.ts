import { matches, runsOn, todaysTrips, websiteUrl, whoIsCheckedIn } from '@/features/admin/logic'
import type { DriverSession, Monitor, PublicUser, Trip } from '@/api/types'

// Admin screens (company admin, school admin / staff): the pure rules behind what they show.

const user = (id: string, over: Partial<PublicUser> = {}): PublicUser => ({
  id,
  email: `${id}@example.test`,
  full_name: id.toUpperCase(),
  role: 'driver',
  phone: '555-0100',
  address: null,
  license_number: null,
  is_active: true,
  email_verified_at: null,
  created_by_user_id: null,
  must_change_password: false,
  ...over,
})
const session = (userId: string, open: boolean): DriverSession =>
  ({ id: `s-${userId}`, user_id: userId, shift_period: 'morning', check_in_at: '2026-09-24T11:00:00Z', check_out_at: open ? null : '2026-09-24T12:00:00Z' }) as DriverSession

describe('whoIsCheckedIn', () => {
  it('lists active drivers with an open shift, then monitors on shift, with who they ride with', () => {
    const drivers = [user('a'), user('b'), user('c', { is_active: false })]
    const sessions = [session('a', true), session('b', false), session('c', true)]
    const monitors = [
      { id: 'm1', full_name: 'Mia', phone: null, is_active: true, assignment: { driver_name: 'A' }, open_session: { id: 'x', shift_period: 'afternoon', check_in_at: '2026-09-24T18:00:00Z' } },
      { id: 'm2', full_name: 'Max', phone: null, is_active: true, assignment: null, open_session: null },
    ] as unknown as Monitor[]
    const list = whoIsCheckedIn(drivers, sessions, monitors)
    expect(list.map((e) => `${e.role}:${e.id}`)).toEqual(['driver:a', 'monitor:m1'])
    expect(list[1]).toMatchObject({ ridesWith: 'A', shift: 'afternoon' })
  })
})

describe('todaysTrips (school pickup screen)', () => {
  const trip = (id: string, created: string, status: 'pending' | 'complete') => ({ id, created_at: created, status }) as Trip
  it("keeps today's trips and any still waiting on the school, waiting first", () => {
    const now = new Date(2026, 8, 24, 15, 0)
    const today = new Date(2026, 8, 24, 8, 0).toISOString()
    const earlier = new Date(2026, 8, 24, 7, 0).toISOString()
    const yesterday = new Date(2026, 8, 23, 8, 0).toISOString()
    const out = todaysTrips(
      [trip('done-today', today, 'complete'), trip('old-done', yesterday, 'complete'), trip('old-waiting', yesterday, 'pending'), trip('waiting', earlier, 'pending')],
      now,
    )
    expect(out.map((t) => t.id)).toEqual(['waiting', 'old-waiting', 'done-today'])
  })
})

describe('runsOn', () => {
  const a = { start_date: '2026-09-01T00:00:00.000Z', end_date: null, days_of_week: [1, 3, 5] }
  it('needs the date range and the weekday', () => {
    expect(runsOn(a, '2026-09-21', 1)).toBe(true)
    expect(runsOn(a, '2026-09-22', 2)).toBe(false)
    expect(runsOn(a, '2026-08-31', 1)).toBe(false) // before it starts
    expect(runsOn({ ...a, end_date: '2026-09-20' }, '2026-09-21', 1)).toBe(false) // ended
  })
  it('defaults to Monday to Friday when the days are missing', () => {
    expect(runsOn({ start_date: '2026-01-01', end_date: null }, '2026-09-26', 6)).toBe(false)
    expect(runsOn({ start_date: '2026-01-01', end_date: null }, '2026-09-25', 5)).toBe(true)
  })
})

describe('search and website links', () => {
  it('matches any field, ignoring case; an empty search matches everything', () => {
    expect(matches('dana', 'Dana Driver', null)).toBe(true)
    expect(matches('EXAMPLE', null, 'x@example.test')).toBe(true)
    expect(matches('zzz', 'Dana')).toBe(false)
    expect(matches('  ', 'anything')).toBe(true)
  })
  it('joins the website address and a page without a double slash', () => {
    expect(websiteUrl('https://site.example/', '/company/payroll')).toBe('https://site.example/company/payroll')
    expect(websiteUrl('https://site.example', '/company')).toBe('https://site.example/company')
  })
})
