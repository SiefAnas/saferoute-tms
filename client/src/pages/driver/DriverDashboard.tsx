import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { getCurrentCoords } from '../../lib/geo'
import { isToday, formatDuration, formatClock } from '../../lib/format'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'
import type { DriverSession, Student, Trip, TripType } from '../../types/api'

// Driver Dashboard (§7.1). Visual language ported from the Stitch "Driver Dashboard"
// mockup (big check-in action, status/hours bento, trip list) — but adapted to the real
// data model: the mockup groups stops under a "Route" (e.g. "Morning Route A-12"), which
// doesn't exist in the schema. What we actually have is per-student pickup/dropoff Trips,
// so this logs and lists those directly rather than fabricating a route concept.
export function DriverDashboard() {
  const queryClient = useQueryClient()
  const [tripType, setTripType] = useState<TripType>('pickup')
  const [studentId, setStudentId] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  // Forces a re-render every 30s so "elapsed time since check-in" stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<DriverSession[]>('/sessions'),
  })
  const tripsQuery = useQuery({
    queryKey: ['trips'],
    queryFn: () => api.get<Trip[]>('/trips'),
  })
  const studentsQuery = useQuery({
    queryKey: ['students'],
    queryFn: () => api.get<Student[]>('/students'),
  })

  const openSession = sessionsQuery.data?.find((s) => s.check_out_at === null)

  const checkIn = useMutation({
    mutationFn: async () => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>('/sessions/checkin', coords ? { check_in_lat: coords.lat, check_in_lng: coords.lng } : {})
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Check-in failed.'),
  })

  const checkOut = useMutation({
    mutationFn: async (id: string) => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>(
        `/sessions/${id}/checkout`,
        coords ? { check_out_lat: coords.lat, check_out_lng: coords.lng } : {},
      )
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Check-out failed.'),
  })

  const logTrip = useMutation({
    mutationFn: () => api.post<Trip>('/trips', { student_id: studentId, trip_type: tripType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      setStudentId('')
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Could not log trip.'),
  })

  const studentName = useMemo(() => {
    const map = new Map((studentsQuery.data ?? []).map((s) => [s.id, s.full_name]))
    return (id: string) => map.get(id) ?? 'Unknown student'
  }, [studentsQuery.data])

  const todaysTrips = useMemo(
    () => (tripsQuery.data ?? []).filter((t) => isToday(t.created_at)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [tripsQuery.data],
  )

  const todaysMinutes = useMemo(() => {
    const completed = (sessionsQuery.data ?? [])
      .filter((s) => s.check_out_at && isToday(s.check_in_at))
      .reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)
    if (openSession && isToday(openSession.check_in_at)) {
      const elapsed = (Date.now() - new Date(openSession.check_in_at).getTime()) / 60_000
      return completed + Math.max(0, elapsed)
    }
    return completed
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-derive on the 30s tick above
  }, [sessionsQuery.data, openSession])

  if (sessionsQuery.isLoading) {
    return <p className="text-body-md text-on-surface-variant">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <Button
          className="h-[72px] w-full"
          onClick={() => (openSession ? checkOut.mutate(openSession.id) : checkIn.mutate())}
          disabled={checkIn.isPending || checkOut.isPending}
        >
          <span className="material-symbols-outlined text-[32px]">{openSession ? 'logout' : 'login'}</span>
          <span className="text-headline-md font-bold">
            {checkIn.isPending || checkOut.isPending ? 'PLEASE WAIT…' : openSession ? 'CHECK OUT' : 'CHECK IN'}
          </span>
        </Button>
      </section>

      {actionError && (
        <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-body-md text-on-error-container">
          {actionError}
        </p>
      )}

      <section className="grid grid-cols-2 gap-4">
        <Card className="flex h-32 flex-col justify-between p-4">
          <span className="text-label-md text-on-surface-variant uppercase">Current Status</span>
          <div className="mt-auto">
            {openSession ? (
              <StatusBadge tone="success" label="Checked In" pulse />
            ) : (
              <StatusBadge tone="neutral" label="Checked Out" />
            )}
          </div>
        </Card>
        <Card className="flex h-32 flex-col justify-between p-4">
          <span className="text-label-md text-on-surface-variant uppercase">Today's Hours</span>
          <span className="mt-auto text-headline-md font-bold text-on-surface">{formatDuration(todaysMinutes)}</span>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-title-lg text-on-surface">Log a Trip</h2>
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex gap-2">
            {(['pickup', 'dropoff'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTripType(t)}
                className={`flex-1 rounded-lg border px-4 py-2 text-label-md capitalize transition-colors ${
                  tripType === t
                    ? 'border-primary bg-primary-fixed text-on-primary-fixed-variant'
                    : 'border-outline-variant text-on-surface-variant'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <select
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            className="h-14 w-full rounded-lg border border-outline bg-surface-container-lowest px-4 text-body-lg outline-none focus:border-primary-container"
          >
            <option value="">Select a student…</option>
            {(studentsQuery.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.full_name}
                {s.grade ? ` (Grade ${s.grade})` : ''}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            disabled={!studentId || !openSession || logTrip.isPending}
            onClick={() => logTrip.mutate()}
          >
            {!openSession ? 'Check in first' : logTrip.isPending ? 'Logging…' : 'Log Trip'}
          </Button>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-title-lg text-on-surface">Today's Trips</h2>
        {todaysTrips.length === 0 ? (
          <p className="text-body-md text-on-surface-variant">No trips logged yet today.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {todaysTrips.map((trip) => (
              <Card key={trip.id} className="flex items-center gap-4 p-4">
                <div className="flex flex-col items-center">
                  <span className="text-headline-md font-bold text-primary">{formatClock(trip.created_at)}</span>
                </div>
                <div className="flex-1">
                  <h3 className="text-title-lg capitalize">
                    {trip.trip_type} — {studentName(trip.student_id)}
                  </h3>
                  {trip.status === 'complete' ? (
                    <StatusBadge tone="success" label={trip.auto_completed ? 'Auto-completed' : 'Complete'} />
                  ) : (
                    <StatusBadge tone="active" label="Awaiting staff confirmation" pulse />
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
