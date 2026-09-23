import { addDaysISO, calendarDateOf, localDateOf, localISODate, mondayOf } from '@/lib/localDate'
import { isAssignmentActiveToday } from '@/lib/format'

// Every check runs under three timezones, the same way client/test/localDate.test.ts does,
// because the old toISOString().slice(0,10) code gave wrong answers in Boston at night (UTC is
// already tomorrow) and in Cairo just after midnight (UTC is still yesterday). Node applies a
// changed process.env.TZ to the next Date it builds, so this works on Windows too.
const ZONES = ['America/New_York', 'Africa/Cairo', 'UTC']

describe.each(ZONES)('local calendar dates (TZ=%s)', (tz) => {
  const original = process.env.TZ

  beforeAll(() => {
    process.env.TZ = tz
  })
  afterAll(() => {
    process.env.TZ = original
  })

  it('keeps a late evening on the same local day', () => {
    // 9:30pm on Sept 22 is still Sept 22, even though UTC has already rolled over in Boston.
    expect(localISODate(new Date(2026, 8, 22, 21, 30))).toBe('2026-09-22')
  })

  it('keeps local midnight on the day that just started', () => {
    // Midnight on the 1st is the 1st, even though UTC is still the 31st in Cairo.
    expect(localISODate(new Date(2026, 8, 1, 0, 0))).toBe('2026-09-01')
  })

  it('reads a Postgres DATE from the API without shifting it', () => {
    expect(calendarDateOf('2026-09-22T00:00:00.000Z')).toBe('2026-09-22')
  })

  it('leaves a plain YYYY-MM-DD alone', () => {
    expect(calendarDateOf('2026-09-22')).toBe('2026-09-22')
  })

  it('treats an assignment that ends today as still active', () => {
    const today = localISODate()
    const yesterday = localISODate(new Date(Date.now() - 86_400_000))
    expect(isAssignmentActiveToday(`${yesterday}T00:00:00.000Z`, `${today}T00:00:00.000Z`)).toBe(true)
  })

  it('treats an assignment that starts tomorrow as not active yet', () => {
    const tomorrow = localISODate(new Date(Date.now() + 86_400_000))
    expect(isAssignmentActiveToday(`${tomorrow}T00:00:00.000Z`, null)).toBe(false)
  })

  it('treats an assignment that ended yesterday as over', () => {
    const yesterday = localISODate(new Date(Date.now() - 86_400_000))
    expect(isAssignmentActiveToday('2026-01-01T00:00:00.000Z', `${yesterday}T00:00:00.000Z`)).toBe(false)
  })

  it('moves a week at a time across months, years and DST changes (Week tab)', () => {
    expect(addDaysISO('2026-09-21', 7)).toBe('2026-09-28')
    expect(addDaysISO('2026-10-02', -7)).toBe('2026-09-25')
    expect(addDaysISO('2026-12-28', 7)).toBe('2027-01-04')
    expect(addDaysISO('2026-10-26', 7)).toBe('2026-11-02') // US DST ends Nov 1
    expect(addDaysISO('2026-03-02', 7)).toBe('2026-03-09') // US DST starts Mar 8
  })

  it('finds the Monday of the week', () => {
    expect(mondayOf(new Date(2026, 8, 23, 22, 0))).toBe('2026-09-21') // Wednesday night
    expect(mondayOf(new Date(2026, 8, 27, 9, 0))).toBe('2026-09-21') // Sunday
    expect(mondayOf(new Date(2026, 8, 21, 0, 0))).toBe('2026-09-21') // Monday midnight
    expect(localDateOf('2026-09-21').getDate()).toBe(21)
  })
})
