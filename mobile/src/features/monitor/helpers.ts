import type { MonitorHome, ShiftPeriod } from '@/api/types'

// Pure helpers for the monitor app (no React Native, no API client), so jest can test them.

// The shift the Today screen opens on: the one they're checked into, else the only shift they
// ride, else morning before noon and afternoon after.
export function defaultMonitorShift(home: MonitorHome | undefined, now: Date = new Date()): ShiftPeriod {
  if (home?.open_session?.shift_period) return home.open_session.shift_period
  const ride = home?.assignment?.shift_period
  if (ride === 'morning' || ride === 'afternoon') return ride
  return now.getHours() < 12 ? 'morning' : 'afternoon'
}

// ISO weekday (1 = Monday ... 7 = Sunday) of a local date.
export function isoWeekday(d: Date = new Date()): number {
  return d.getDay() === 0 ? 7 : d.getDay()
}

export function ridesToday(home: MonitorHome | undefined, now: Date = new Date()): boolean {
  return Boolean(home?.assignment?.days_of_week.includes(isoWeekday(now)))
}

export const SHIFT_TEXT = { morning: 'Mornings', afternoon: 'Afternoons', both: 'Mornings and afternoons' } as const
