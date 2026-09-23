import { useMemo } from 'react'
import { useQueries, useQuery, type UseQueryResult } from '@tanstack/react-query'
import { api } from '@/api'
import type {
  Assignment,
  DriverSession,
  ShiftPeriod,
  Student,
  TodayScheduleItem,
  Trip,
  Van,
  WeekSchedule,
} from '@/api/types'
import { isToday } from '@/lib/format'
import { currentAssignmentBy } from '@/lib/fleet'

// Data shared by the driver app's tabs, ported from client/src/pages/driver/driverData.ts so
// the two apps derive the same things from the same endpoints. Every query key matches the web
// app's, which keeps the invalidation after check-in / logging a trip identical.
//
// Everything here only needs the driver's OWN data: /schedule/today, /sessions, /trips and
// /assignments are all scoped to the signed-in driver server-side. The app never lists the
// company's students.

export { itemsForShift, shiftName, tripTypeFor } from './shift'

export function useDriverSessions() {
  const query = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<DriverSession[]>('/sessions') })
  const sessions = useMemo(() => query.data ?? [], [query.data])

  // A driver is checked into at most one shift at a time. It can be a legacy session with no
  // shift_period (from before the morning/afternoon split), which still has to be closable.
  const openSession = useMemo(() => sessions.find((s) => s.check_out_at === null), [sessions])

  // Shifts already worked and closed today, for the "Shift ended" state. The server's own
  // "you already worked this shift" rule uses the DATABASE's day (check_in_at::date =
  // CURRENT_DATE, and Neon is on GMT), so in the evening in the US this local-day view can
  // disagree with it. That is fine: this only decides what to draw. The app always sends the
  // check-in request and shows the server's 409 if the server disagrees.
  const endedToday = useMemo(() => {
    const done = new Map<ShiftPeriod, DriverSession>()
    for (const s of sessions) {
      if (s.shift_period && s.check_out_at !== null && isToday(s.check_in_at)) done.set(s.shift_period, s)
    }
    return done
  }, [sessions])

  return { query, sessions, openSession, endedToday }
}

export function useTodaySchedule(): UseQueryResult<TodayScheduleItem[]> {
  return useQuery({ queryKey: ['schedule-today'], queryFn: () => api.get<TodayScheduleItem[]>('/schedule/today') })
}

// The driver's 7 days from `start` (a Monday, "YYYY-MM-DD"). Same key as the web Week tab.
export function useWeekSchedule(start: string): UseQueryResult<WeekSchedule> {
  return useQuery({ queryKey: ['schedule-week', start], queryFn: () => api.get<WeekSchedule>(`/schedule/week?start=${start}`) })
}

export function useTodaysTrips() {
  const query = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })
  // GET /trips returns every trip the driver ever logged, oldest first, so today's rows have
  // to be filtered by the LOCAL calendar day of created_at (API_CONTRACT.md §7).
  const today = useMemo(
    () =>
      (query.data ?? [])
        .filter((t) => isToday(t.created_at))
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [query.data],
  )
  return { query, today }
}

// Full student records (address, notes, extra contacts) for the students on today's schedule.
// One GET /students/:id per student, keyed the same way the student sheet keys its own fetch,
// so opening a sheet reuses what is already cached. Only ids that came from /schedule/today
// are ever requested — the app never enumerates the company's students.
export function useStudentDetails(ids: string[]): Map<string, Student> {
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['student', id],
      queryFn: () => api.get<Student>(`/students/${id}`),
      staleTime: 5 * 60_000,
    })),
  })
  return useMemo(() => {
    const byId = new Map<string, Student>()
    for (const r of results) if (r.data) byId.set(r.data.id, r.data)
    return byId
  }, [results])
}

// The van the driver is on today: the van on their current active assignment. Fetched by id
// (GET /vans/:id) rather than listing every company van, so the driver app only ever asks for
// the driver's own data. If the van can't be read the header just leaves it out.
export function useMyVan(): { van: Van | null; isLoading: boolean } {
  const assignmentsQuery = useQuery({
    queryKey: ['assignments'],
    queryFn: () => api.get<Assignment[]>('/assignments'),
  })
  const vanId = useMemo(
    () => [...currentAssignmentBy(assignmentsQuery.data ?? [], 'driver_user_id').values()][0]?.van_id ?? null,
    [assignmentsQuery.data],
  )
  const vanQuery = useQuery({
    queryKey: ['van', vanId],
    queryFn: () => api.get<Van>(`/vans/${vanId}`),
    enabled: vanId !== null,
    staleTime: 5 * 60_000,
  })

  return { van: vanQuery.data ?? null, isLoading: assignmentsQuery.isLoading || (vanId !== null && vanQuery.isLoading) }
}

export function homeAddress(s: Student | undefined): { line1: string; line2: string } | null {
  if (!s?.street_address) return null
  return {
    line1: s.street_address,
    line2: [s.city, [s.state, s.zip_code].filter(Boolean).join(' ')].filter(Boolean).join(', '),
  }
}
