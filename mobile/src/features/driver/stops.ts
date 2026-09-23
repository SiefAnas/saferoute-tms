import type { ShiftPeriod, TodayScheduleItem, Trip } from '@/api/types'
import type { ToneName } from '@/theme/tokens'
import { itemsForShift, tripTypeFor } from './shift'

export type StopState = 'todo' | 'awaiting' | 'confirmed' | 'noshow' | 'skipped'

export interface Stop {
  item: TodayScheduleItem
  state: StopState
  /** Effective time for this shift ("HH:MM:SS"), today's override applied. */
  time: string | null
  timeChanged: boolean
  parentSkipped: boolean
  trip: Trip | undefined
}

export const STATE_LABEL: Record<Exclude<StopState, 'todo'>, { label: string; toneName: ToneName }> = {
  awaiting: { label: 'Awaiting school', toneName: 'caution' },
  confirmed: { label: 'Confirmed', toneName: 'success' },
  noshow: { label: 'No-show', toneName: 'alert' },
  skipped: { label: 'Parent skipped', toneName: 'info' },
}

// Every stop's state on one shift, from real data only: a logged trip (pending → awaiting the
// school, complete → confirmed), a no-show the driver reported, a parent skip, or an office
// skip override. Nothing here is guessed — each state maps to a row the API returned.
//
// Ported from client/src/pages/driver/DriverTodayPage.tsx so both apps read the schedule the
// same way.
export function buildStops(items: TodayScheduleItem[], period: ShiftPeriod, trips: Trip[]): Stop[] {
  return itemsForShift(items, period)
    .map((item): Stop => {
      const usual = period === 'morning' ? item.pickup_time : item.dropoff_time
      const override = period === 'morning' ? item.override?.pickup_time : item.override?.dropoff_time
      const time = override ?? usual
      const mine = trips.filter((t) => t.student_id === item.student.id && t.shift_period === period)
      // Prefer the trip type this shift logs; fall back to any trip for the student on this
      // shift, so a trip logged the other way round still shows as handled.
      const trip = mine.find((t) => t.trip_type === tripTypeFor(period)) ?? mine[0]
      const parentSkipped = item.parent_skipped[period]

      let state: StopState = 'todo'
      if (trip) state = trip.status === 'complete' ? 'confirmed' : 'awaiting'
      else if (item.no_show_reported[period]) state = 'noshow'
      else if (parentSkipped || item.override?.skip) state = 'skipped'

      return { item, state, time, timeChanged: Boolean(override) && override !== usual, parentSkipped, trip }
    })
    .sort(
      (a, b) =>
        (a.time ?? '99').localeCompare(b.time ?? '99') || a.item.student.name.localeCompare(b.item.student.name),
    )
}

// Which shift to show when the screen opens: the one the driver is checked into, otherwise the
// one that matches the time of day on their own phone. Display only — check-in is a separate
// action and the server decides whether it is allowed.
export function defaultShift(openShiftPeriod: ShiftPeriod | null | undefined, now: Date = new Date()): ShiftPeriod {
  if (openShiftPeriod) return openShiftPeriod
  return now.getHours() < 12 ? 'morning' : 'afternoon'
}
