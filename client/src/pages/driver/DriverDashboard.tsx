import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { getCurrentCoords } from '../../lib/geo'
import { isToday, formatDuration, formatClock, formatMoney, formatTimeOfDay } from '../../lib/format'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'
import { Modal } from '../../components/Modal'
import { MonthCalendar } from '../../components/MonthCalendar'
import type { DriverSession, Student, SchoolDetail, Trip, TripType, TodayScheduleItem, PaySummary } from '../../types/api'

function monthRange(d: Date) {
  const from = new Date(d.getFullYear(), d.getMonth(), 1)
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 1)
  const iso = (x: Date) => x.toISOString().slice(0, 10)
  return { from: iso(from), to: iso(to) }
}

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Driver Dashboard (§7.1, reworked). Visual language ported from the Stitch "Driver
// Dashboard" mockup (big check-in action, status/hours bento, trip list) — but adapted to
// the real data model: the mockup groups stops under a "Route" (e.g. "Morning Route
// A-12"), which doesn't exist in the schema. What we actually have is per-student
// pickup/dropoff Trips and, since this rework, a real daily schedule sourced from
// Assignments (§ Driver dashboard rework) rather than a free-form "pick any student" form.
export function DriverDashboard() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const [actionError, setActionError] = useState<string | null>(null)
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null)
  const [detailSchoolId, setDetailSchoolId] = useState<string | null>(null)
  // Per-row Pickup/Drop-off marker — a status choice, not a live action; Confirm is what
  // actually logs the trip. Defaults to 'pickup' per assignment until touched.
  const [rowType, setRowType] = useState<Record<string, TripType>>({})
  // Forces a re-render every 30s so "elapsed time since check-in" stays live.
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const sessionsQuery = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<DriverSession[]>('/sessions') })
  const tripsQuery = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })
  const scheduleQuery = useQuery({ queryKey: ['schedule-today'], queryFn: () => api.get<TodayScheduleItem[]>('/schedule/today') })

  const { from, to } = useMemo(() => monthRange(new Date()), [])
  const paySummaryQuery = useQuery({
    queryKey: ['payroll-summary', user?.id, from, to],
    queryFn: () => api.get<PaySummary>(`/payroll/summary/${user!.id}?from=${from}&to=${to}`),
    enabled: Boolean(user?.id),
    retry: false, // a 404 (no pay rule configured) is an expected state, not worth retrying
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
    mutationFn: (vars: { studentId: string; tripType: TripType }) =>
      api.post<Trip>('/trips', { student_id: vars.studentId, trip_type: vars.tripType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Could not log trip.'),
  })

  const todaysTrips = useMemo(
    () => (tripsQuery.data ?? []).filter((t) => isToday(t.created_at)).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [tripsQuery.data],
  )

  const studentName = useMemo(() => {
    const map = new Map((scheduleQuery.data ?? []).map((s) => [s.student.id, s.student.name]))
    return (id: string) => map.get(id) ?? 'Unknown student'
  }, [scheduleQuery.data])

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

  // Days worked this month, derived from the already-fetched sessions — no new endpoint.
  const workedDaysMarked = useMemo(() => {
    const marks: Record<string, { color: string }> = {}
    const now = new Date()
    for (const s of sessionsQuery.data ?? []) {
      const d = new Date(s.check_in_at)
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        marks[dateKey(d)] = { color: 'bg-primary' }
      }
    }
    return marks
  }, [sessionsQuery.data])

  if (sessionsQuery.isLoading) {
    return <p className="text-body-md text-on-surface-variant">Loading…</p>
  }

  const now = new Date()

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

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-2 p-4">
          <span className="text-label-md text-on-surface-variant uppercase">This Month's Pay</span>
          {paySummaryQuery.isLoading ? (
            <p className="text-body-md text-on-surface-variant">Loading…</p>
          ) : paySummaryQuery.error instanceof ApiError && paySummaryQuery.error.status === 404 ? (
            <p className="text-body-md text-on-surface-variant">No pay rate configured yet.</p>
          ) : paySummaryQuery.data ? (
            <div className="flex flex-col gap-1">
              {paySummaryQuery.data.rate_type === 'hourly' ? (
                <span className="text-body-md text-on-surface-variant">
                  {(paySummaryQuery.data.worked_minutes / 60).toFixed(1)} hours worked
                </span>
              ) : (
                <span className="text-body-md text-on-surface-variant">{paySummaryQuery.data.worked_days} days worked</span>
              )}
              <span className="text-headline-md font-bold text-on-surface">{formatMoney(paySummaryQuery.data.total_pay_cents)}</span>
            </div>
          ) : null}
        </Card>
        <Card className="flex flex-col gap-2 p-4">
          <span className="text-label-md text-on-surface-variant uppercase">Worked This Month</span>
          <MonthCalendar year={now.getFullYear()} month={now.getMonth() + 1} markedDates={workedDaysMarked} />
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-title-lg text-on-surface">Today's Schedule</h2>
        {scheduleQuery.isLoading ? (
          <p className="text-body-md text-on-surface-variant">Loading…</p>
        ) : (scheduleQuery.data ?? []).length === 0 ? (
          <p className="text-body-md text-on-surface-variant">No students assigned to you today.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {(scheduleQuery.data ?? []).map((item) => {
              const type = rowType[item.assignment_id] ?? 'pickup'
              const skip = item.override?.skip ?? false
              const effectivePickup = item.override?.pickup_time ?? item.pickup_time
              const effectiveDropoff = item.override?.dropoff_time ?? item.dropoff_time
              const pickupChanged = Boolean(item.override?.pickup_time) && item.override!.pickup_time !== item.pickup_time
              const dropoffChanged = Boolean(item.override?.dropoff_time) && item.override!.dropoff_time !== item.dropoff_time
              const loggedToday = todaysTrips.filter((t) => t.student_id === item.student.id)
              const alreadyLogged = loggedToday.some((t) => t.trip_type === type)

              return (
                <Card key={item.assignment_id} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <button
                        type="button"
                        onClick={() => setDetailStudentId(item.student.id)}
                        className="text-title-lg font-medium text-primary hover:underline"
                      >
                        {item.student.name}
                      </button>
                      {item.student.grade && <span className="ml-2 text-label-md text-on-surface-variant">Grade {item.student.grade}</span>}
                      <div>
                        <button
                          type="button"
                          onClick={() => setDetailSchoolId(item.school.id)}
                          className="text-body-md text-secondary hover:underline"
                        >
                          {item.school.name}
                        </button>
                      </div>
                      <p className="text-body-md text-on-surface-variant">
                        {item.student.parent_name ?? '—'} {item.student.parent_phone ? `· ${item.student.parent_phone}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-right">
                      {skip ? (
                        <span className="text-label-md font-medium text-error">No pickup/dropoff today</span>
                      ) : (
                        <>
                          <span className={`text-body-md ${pickupChanged ? 'font-bold text-error' : 'text-on-surface-variant'}`}>
                            Pickup: {formatTimeOfDay(effectivePickup)}
                          </span>
                          <span className={`text-body-md ${dropoffChanged ? 'font-bold text-error' : 'text-on-surface-variant'}`}>
                            Dropoff: {formatTimeOfDay(effectiveDropoff)}
                          </span>
                        </>
                      )}
                      {item.override?.note && <span className="text-label-md text-on-surface-variant">{item.override.note}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {(['pickup', 'dropoff'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setRowType((prev) => ({ ...prev, [item.assignment_id]: t }))}
                        className={`flex-1 rounded-lg border px-4 py-2 text-label-md capitalize transition-colors ${
                          type === t
                            ? 'border-primary bg-primary-fixed text-on-primary-fixed-variant'
                            : 'border-outline-variant text-on-surface-variant'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                    <Button
                      variant="secondary"
                      className="h-10 px-4 text-label-md"
                      disabled={!openSession || logTrip.isPending || alreadyLogged}
                      onClick={() => logTrip.mutate({ studentId: item.student.id, tripType: type })}
                    >
                      {!openSession ? 'Check in first' : alreadyLogged ? 'Already logged' : 'Confirm'}
                    </Button>
                  </div>

                  {loggedToday.length > 0 && (
                    <div className="flex gap-3 text-label-md text-on-surface-variant">
                      {loggedToday.map((t) => (
                        <span key={t.id} className="flex items-center gap-1">
                          <span className="material-symbols-outlined !text-[16px] text-green-600">check_circle</span>
                          {t.trip_type} logged at {formatClock(t.created_at)}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        )}
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

      {detailStudentId && (
        <StudentDetailModal studentId={detailStudentId} trips={tripsQuery.data ?? []} onClose={() => setDetailStudentId(null)} />
      )}
      {detailSchoolId && <SchoolDetailModal schoolId={detailSchoolId} onClose={() => setDetailSchoolId(null)} />}
    </div>
  )
}

function StudentDetailModal({ studentId, trips, onClose }: { studentId: string; trips: Trip[]; onClose: () => void }) {
  const studentQuery = useQuery({ queryKey: ['student', studentId], queryFn: () => api.get<Student>(`/students/${studentId}`) })
  const now = new Date()

  const markedDates = useMemo(() => {
    const marks: Record<string, { color: string; label?: string }> = {}
    for (const t of trips) {
      if (t.student_id !== studentId) continue
      const d = new Date(t.created_at)
      if (d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth()) continue
      const key = dateKey(d)
      const existing = marks[key]
      marks[key] = { color: 'bg-primary', label: existing?.label ? `${existing.label}, ${t.trip_type}` : t.trip_type }
    }
    return marks
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` is stable for the modal's lifetime
  }, [trips, studentId])

  const s = studentQuery.data
  return (
    <Modal title={s?.full_name ?? 'Student'} onClose={onClose}>
      {studentQuery.isLoading || !s ? (
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      ) : (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-md">
            <dt className="text-on-surface-variant">Grade</dt>
            <dd>{s.grade ?? '—'}</dd>
            <dt className="text-on-surface-variant">Age</dt>
            <dd>{s.age ?? '—'}</dd>
            <dt className="text-on-surface-variant">Address</dt>
            <dd>{s.address ?? '—'}</dd>
            <dt className="text-on-surface-variant">Parent/Guardian</dt>
            <dd>{s.parent_name ?? '—'}</dd>
            <dt className="text-on-surface-variant">Parent Phone</dt>
            <dd>{s.parent_phone ?? '—'}</dd>
          </dl>

          {s.notes && (
            <p className="rounded-lg border border-outline-variant bg-surface-container px-3 py-2 text-body-md text-on-surface-variant">
              <strong className="text-on-surface">Note:</strong> {s.notes}
            </p>
          )}

          {s.contacts && s.contacts.length > 0 && (
            <div>
              <h3 className="mb-1 text-title-md text-primary">Additional Contacts</h3>
              <ul className="flex flex-col gap-1 text-body-md text-on-surface-variant">
                {s.contacts.map((c) => (
                  <li key={c.id}>
                    {c.name}
                    {c.relationship ? ` (${c.relationship})` : ''}
                    {c.phone ? ` — ${c.phone}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="mb-1 text-title-md text-primary">This Month's Trips</h3>
            <MonthCalendar year={now.getFullYear()} month={now.getMonth() + 1} markedDates={markedDates} />
          </div>
        </>
      )}
    </Modal>
  )
}

function SchoolDetailModal({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const schoolQuery = useQuery({ queryKey: ['school-detail', schoolId], queryFn: () => api.get<SchoolDetail>(`/schools/${schoolId}`) })
  const s = schoolQuery.data
  return (
    <Modal title={s?.name ?? 'School'} onClose={onClose}>
      {schoolQuery.isLoading || !s ? (
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-body-md">
          <dt className="text-on-surface-variant">Address</dt>
          <dd>{s.address ?? '—'}</dd>
          <dt className="text-on-surface-variant">State/Zip</dt>
          <dd>
            {s.state ?? '—'} {s.zip_code ?? ''}
          </dd>
          <dt className="text-on-surface-variant">Phone</dt>
          <dd>{s.phone ?? '—'}</dd>
          <dt className="text-on-surface-variant">Hours</dt>
          <dd>{s.hours ?? '—'}</dd>
          <dt className="text-on-surface-variant">Website</dt>
          <dd>{s.website ?? '—'}</dd>
        </dl>
      )}
    </Modal>
  )
}
