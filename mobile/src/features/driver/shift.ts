import type { ShiftPeriod, TodayScheduleItem } from '@/api/types'

// The shift rules the driver app is built on. Kept free of React and of the API client so the
// logic that decides what a driver sees can be tested on its own.

export const shiftName = (period: ShiftPeriod): string => (period === 'morning' ? 'Morning' : 'Afternoon')

// An item belongs to a shift's schedule if the assignment covers that shift specifically, or
// covers 'both' (the driver does the full day for that student).
export function itemsForShift(items: TodayScheduleItem[], shiftPeriod: ShiftPeriod): TodayScheduleItem[] {
  return items.filter((i) => i.shift_period === shiftPeriod || i.shift_period === 'both')
}

// One trip per stop: a morning stop is a pickup, an afternoon stop a drop-off.
export const tripTypeFor = (period: ShiftPeriod): 'pickup' | 'dropoff' =>
  period === 'morning' ? 'pickup' : 'dropoff'
