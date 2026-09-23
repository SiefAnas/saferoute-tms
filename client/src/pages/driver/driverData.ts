import { useMemo } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { isToday } from '../../lib/format'
import { currentAssignmentBy } from '../../lib/fleet'
import type { Assignment, DriverSession, ShiftPeriod, Student, TodayScheduleItem, Trip, Van } from '../../types/api'

// Data shared by the driver app's tabs. Every query key matches the one the rest of the app
// already uses, so invalidation after check-in / logging a trip keeps working unchanged.

export const shiftName = (period: ShiftPeriod) => (period === 'morning' ? 'Morning' : 'Afternoon')

// An item belongs to a shift's schedule if the assignment covers that shift specifically, or
// covers 'both' (the driver does the full day for that student).
export function itemsForShift(items: TodayScheduleItem[], shiftPeriod: ShiftPeriod) {
  return items.filter((i) => i.shift_period === shiftPeriod || i.shift_period === 'both')
}

// The design's one trip per stop: a morning stop is a pickup, an afternoon stop a drop-off.
export const tripTypeFor = (period: ShiftPeriod) => (period === 'morning' ? 'pickup' : 'dropoff')

export function useDriverSessions() {
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<DriverSession[]>('/sessions') })
  const sessions = useMemo(() => q.data ?? [], [q.data])
  // A driver is checked into at most one shift at a time. It can be a legacy session with no
  // shift_period (from before the morning/afternoon split), which still has to be closable.
  const openSession = useMemo(() => sessions.find((s) => s.check_out_at === null), [sessions])
  // Shifts already worked and closed today. The server won't let a driver return to one.
  const endedToday = useMemo(() => {
    const done = new Map<ShiftPeriod, DriverSession>()
    for (const s of sessions) {
      if (s.shift_period && s.check_out_at !== null && isToday(s.check_in_at)) done.set(s.shift_period, s)
    }
    return done
  }, [sessions])
  return { query: q, sessions, openSession, endedToday }
}

export function useTodaySchedule() {
  return useQuery({ queryKey: ['schedule-today'], queryFn: () => api.get<TodayScheduleItem[]>('/schedule/today') })
}

export function useTodaysTrips() {
  const q = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })
  const today = useMemo(
    () => (q.data ?? []).filter((t) => isToday(t.created_at)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [q.data],
  )
  return { query: q, today }
}

// Full student records (address, notes, extra contacts) for the students on today's schedule.
// GET /students/:id per student, with the same ['student', id] key the student sheet uses.
export function useStudentDetails(ids: string[]) {
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: ['student', id], queryFn: () => api.get<Student>(`/students/${id}`), staleTime: 5 * 60_000 })),
  })
  const byId = new Map<string, Student>()
  results.forEach((r) => {
    if (r.data) byId.set(r.data.id, r.data)
  })
  return byId
}

// The van the driver is driving today: the van on their current active assignment.
export function useMyVan() {
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  return useMemo(() => {
    const mine = [...currentAssignmentBy(assignmentsQuery.data ?? [], 'driver_user_id').values()][0]
    return mine ? (vansQuery.data ?? []).find((v) => v.id === mine.van_id) ?? null : null
  }, [assignmentsQuery.data, vansQuery.data])
}

export function homeAddress(s: Student | undefined) {
  if (!s?.street_address) return null
  return { line1: s.street_address, line2: [s.city, [s.state, s.zip_code].filter(Boolean).join(' ')].filter(Boolean).join(', ') }
}

// Local clock time without a leading zero: "6:48 AM".
export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
