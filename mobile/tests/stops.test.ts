import type { TodayScheduleItem, Trip } from '@/api/types'
import { buildStops, defaultShift } from '@/features/driver/stops'
import { itemsForShift, tripTypeFor } from '@/features/driver/shift'

// buildStops decides what the driver sees for every student on a shift, so it is worth
// pinning down: a state here comes only from a row the API returned, never from a guess.

function item(over: Partial<TodayScheduleItem> & { id: string; name: string }): TodayScheduleItem {
  return {
    assignment_id: `a-${over.id}`,
    shift_period: 'both',
    pickup_time: '07:10:00',
    dropoff_time: '15:20:00',
    student: { id: over.id, name: over.name, grade: '3', parent_name: null, parent_phone: null },
    school: { id: 'school-1', name: 'Lincoln Elementary' },
    override: null,
    parent_skipped: { morning: false, afternoon: false },
    no_show_reported: { morning: false, afternoon: false },
    route: {
      morning: { from: { kind: 'home', label: 'Home', address: '1 Oak St' }, to: { kind: 'school', label: 'Lincoln Elementary', address: null } },
      afternoon: { from: { kind: 'school', label: 'Lincoln Elementary', address: null }, to: { kind: 'home', label: 'Home', address: '1 Oak St' } },
    },
    ...over,
  }
}

function trip(over: Partial<Trip> & { student_id: string }): Trip {
  return {
    id: `t-${over.student_id}`,
    session_id: 's1',
    company_id: 'c1',
    school_id: 'school-1',
    trip_type: 'pickup',
    shift_period: 'morning',
    driver_confirmed_at: '2026-09-23T11:10:00.000Z',
    staff_confirmed_at: null,
    status: 'pending',
    auto_completed: false,
    completed_at: null,
    created_at: '2026-09-23T11:10:00.000Z',
    updated_at: '2026-09-23T11:10:00.000Z',
    driver_name: 'Luis Ortega',
    driver_phone: null,
    ...over,
  }
}

describe('itemsForShift', () => {
  it("includes 'both' assignments in each shift", () => {
    const items = [
      item({ id: '1', name: 'A', shift_period: 'both' }),
      item({ id: '2', name: 'B', shift_period: 'morning' }),
      item({ id: '3', name: 'C', shift_period: 'afternoon' }),
    ]
    expect(itemsForShift(items, 'morning').map((i) => i.student.id)).toEqual(['1', '2'])
    expect(itemsForShift(items, 'afternoon').map((i) => i.student.id)).toEqual(['1', '3'])
  })
})

describe('tripTypeFor', () => {
  it('logs a morning stop as a pickup and an afternoon stop as a drop-off', () => {
    expect(tripTypeFor('morning')).toBe('pickup')
    expect(tripTypeFor('afternoon')).toBe('dropoff')
  })
})

describe('buildStops', () => {
  it('marks a stop todo when nothing has happened', () => {
    const stops = buildStops([item({ id: '1', name: 'Maya' })], 'morning', [])
    expect(stops).toHaveLength(1)
    expect(stops[0]!.state).toBe('todo')
    expect(stops[0]!.time).toBe('07:10:00')
    expect(stops[0]!.timeChanged).toBe(false)
  })

  it('marks a pending trip as awaiting the school, and a complete one as confirmed', () => {
    const items = [item({ id: '1', name: 'Maya' })]
    expect(buildStops(items, 'morning', [trip({ student_id: '1' })])[0]!.state).toBe('awaiting')
    expect(
      buildStops(items, 'morning', [trip({ student_id: '1', status: 'complete' })])[0]!.state,
    ).toBe('confirmed')
  })

  it('marks a reported no-show', () => {
    const items = [item({ id: '1', name: 'Maya', no_show_reported: { morning: true, afternoon: false } })]
    expect(buildStops(items, 'morning', [])[0]!.state).toBe('noshow')
    // The afternoon leg of the same assignment is untouched.
    expect(buildStops(items, 'afternoon', [])[0]!.state).toBe('todo')
  })

  it("marks a parent's skip, per shift", () => {
    const items = [item({ id: '1', name: 'Maya', parent_skipped: { morning: true, afternoon: false } })]
    expect(buildStops(items, 'morning', [])[0]!.state).toBe('skipped')
    expect(buildStops(items, 'morning', [])[0]!.parentSkipped).toBe(true)
    expect(buildStops(items, 'afternoon', [])[0]!.state).toBe('todo')
  })

  it("marks the office's skip override", () => {
    const items = [
      item({
        id: '1',
        name: 'Maya',
        override: { pickup_time: null, dropoff_time: null, skip: true, note: 'No school run' },
      }),
    ]
    expect(buildStops(items, 'morning', [])[0]!.state).toBe('skipped')
  })

  it('prefers a logged trip over a skip flag, because the ride actually happened', () => {
    const items = [item({ id: '1', name: 'Maya', parent_skipped: { morning: true, afternoon: false } })]
    expect(buildStops(items, 'morning', [trip({ student_id: '1' })])[0]!.state).toBe('awaiting')
  })

  it("uses today's override time and flags it as changed", () => {
    const items = [
      item({
        id: '1',
        name: 'Maya',
        override: { pickup_time: '07:50:00', dropoff_time: null, skip: false, note: 'Late start' },
      }),
    ]
    const morning = buildStops(items, 'morning', [])[0]!
    expect(morning.time).toBe('07:50:00')
    expect(morning.timeChanged).toBe(true)

    // The afternoon has no override of its own, so it keeps the usual time.
    const afternoon = buildStops(items, 'afternoon', [])[0]!
    expect(afternoon.time).toBe('15:20:00')
    expect(afternoon.timeChanged).toBe(false)
  })

  it('ignores a trip logged on the other shift', () => {
    const items = [item({ id: '1', name: 'Maya' })]
    const afternoonTrip = trip({ student_id: '1', shift_period: 'afternoon', trip_type: 'dropoff' })
    expect(buildStops(items, 'morning', [afternoonTrip])[0]!.state).toBe('todo')
    expect(buildStops(items, 'afternoon', [afternoonTrip])[0]!.state).toBe('awaiting')
  })

  it('orders stops by time, then by name', () => {
    const items = [
      item({ id: '1', name: 'Zoe', pickup_time: '07:30:00' }),
      item({ id: '2', name: 'Adam', pickup_time: '07:10:00' }),
      item({ id: '3', name: 'Bea', pickup_time: '07:10:00' }),
    ]
    expect(buildStops(items, 'morning', []).map((s) => s.item.student.name)).toEqual(['Adam', 'Bea', 'Zoe'])
  })

  it('puts a stop with no time last rather than dropping it', () => {
    const items = [
      item({ id: '1', name: 'Zoe', pickup_time: null }),
      item({ id: '2', name: 'Adam', pickup_time: '07:10:00' }),
    ]
    const stops = buildStops(items, 'morning', [])
    expect(stops.map((s) => s.item.student.name)).toEqual(['Adam', 'Zoe'])
    expect(stops[1]!.time).toBeNull()
  })
})

describe('defaultShift', () => {
  it('follows the shift the driver is checked into', () => {
    expect(defaultShift('afternoon', new Date(2026, 8, 23, 8, 0))).toBe('afternoon')
    expect(defaultShift('morning', new Date(2026, 8, 23, 16, 0))).toBe('morning')
  })

  it('falls back to the time of day when no shift is open', () => {
    expect(defaultShift(null, new Date(2026, 8, 23, 6, 45))).toBe('morning')
    expect(defaultShift(null, new Date(2026, 8, 23, 11, 59))).toBe('morning')
    expect(defaultShift(undefined, new Date(2026, 8, 23, 12, 0))).toBe('afternoon')
    expect(defaultShift(null, new Date(2026, 8, 23, 19, 30))).toBe('afternoon')
  })
})
