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
import { ContactLink } from '../../components/ContactLink'
import type { DriverSession, Student, SchoolDetail, ShiftPeriod, Trip, TripType, TodayScheduleItem, PaySummary } from '../../types/api'

const SHIFTS: { period: ShiftPeriod; label: string }[] = [
  { period: 'morning', label: 'Morning Shift' },
  { period: 'afternoon', label: 'Afternoon Shift' },
]

const shiftName = (period: ShiftPeriod) => (period === 'morning' ? 'Morning' : 'Afternoon')

// An item belongs to a shift's schedule section if the assignment covers that shift
// specifically, or covers 'both' (the driver does the full day for that student).
function itemsForShift(items: TodayScheduleItem[], shiftPeriod: ShiftPeriod) {
  return items.filter((i) => i.shift_period === shiftPeriod || i.shift_period === 'both')
}

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
  // The shift the driver asked to switch INTO while another shift is still open; non-null
  // shows the confirmation dialog. Nothing is sent until they confirm.
  const [pendingSwitch, setPendingSwitch] = useState<ShiftPeriod | null>(null)
  // Per-row Pickup/Drop-off marker — a status choice, not a live action; Confirm is what
  // actually logs the trip. Defaults to 'pickup' per assignment until touched. Keyed by
  // `assignmentId|shiftPeriod` since a 'both' assignment shows up under both shift sections
  // and each needs its own independent toggle.
  const [rowType, setRowType] = useState<Record<string, TripType>>({})
  // Forces a re-render every 30s so "elapsed time since check-in" stays live.
  const [tick, setTick] = useState(0)
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

  // A driver is checked into at most one shift at a time. `currentSession` is that open
  // session, whichever period it is; it can be a legacy one with no shift_period (recorded
  // before the morning/afternoon split), which still has to be visible so it can be closed.
  const currentSession = useMemo(
    () => (sessionsQuery.data ?? []).find((s) => s.check_out_at === null),
    [sessionsQuery.data],
  )
  const openSessionByShift = useMemo(() => {
    const map: Partial<Record<ShiftPeriod, DriverSession>> = {}
    if (currentSession?.shift_period) map[currentSession.shift_period] = currentSession
    return map
  }, [currentSession])
  // Shifts already worked and closed today. The server won't let a driver return to one.
  const endedShiftsToday = useMemo(() => {
    const done = new Set<ShiftPeriod>()
    for (const s of sessionsQuery.data ?? []) {
      if (s.shift_period && s.check_out_at !== null && isToday(s.check_in_at)) done.add(s.shift_period)
    }
    return done
  }, [sessionsQuery.data])

  const checkIn = useMutation({
    mutationFn: async (vars: { shiftPeriod: ShiftPeriod; confirmSwitch?: boolean }) => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>('/sessions/checkin', {
        shift_period: vars.shiftPeriod,
        ...(vars.confirmSwitch ? { confirm_switch: true } : {}),
        ...(coords ? { check_in_lat: coords.lat, check_in_lng: coords.lng } : {}),
      })
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

  // Checking into a shift while another is open needs a confirmation first; with nothing
  // open it goes straight through.
  function requestCheckIn(period: ShiftPeriod) {
    setActionError(null)
    if (currentSession) setPendingSwitch(period)
    else checkIn.mutate({ shiftPeriod: period })
  }

  const logTrip = useMutation({
    mutationFn: (vars: { studentId: string; tripType: TripType; shiftPeriod: ShiftPeriod }) =>
      api.post<Trip>('/trips', { student_id: vars.studentId, trip_type: vars.tripType, shift_period: vars.shiftPeriod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Could not log trip.'),
  })

  // "When they arrive and no one shows up" — real feature, notifies the school + company
  // admin (server/src/services/schedule.js's markNoShow), same as the parent's Skip Pickup.
  const markAbsent = useMutation({
    mutationFn: (vars: { assignmentId: string; shiftPeriod: ShiftPeriod }) =>
      api.post<{ reported: boolean }>(`/schedule/${vars.assignmentId}/no-show`, { shift_period: vars.shiftPeriod }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['schedule-today'] }),
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Could not report the no-show.'),
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
    // At most one session is open at a time, but summing keeps this correct for any legacy
    // open session too.
    const openElapsed = (sessionsQuery.data ?? [])
      .filter((s) => s.check_out_at === null && isToday(s.check_in_at))
      .reduce((sum, s) => sum + Math.max(0, (Date.now() - new Date(s.check_in_at).getTime()) / 60_000), 0)
    return completed + openElapsed
    // tick is intentionally a dep with no other use here - it's what forces this to
    // re-derive on the 30s tick above instead of freezing at whatever it was on check-in.
  }, [sessionsQuery.data, tick])

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
      {actionError && (
        <p role="alert" className="rounded-lg bg-error-container px-4 py-2 text-body-md text-on-error-container">
          {actionError}
        </p>
      )}

      {currentSession && !currentSession.shift_period && (
        <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body-md text-on-surface">
            You have an open shift from before shifts were split into Morning and Afternoon (checked in{' '}
            {formatClock(currentSession.check_in_at)}). Check out to end it, or check into a shift below to end it and switch.
          </p>
          <Button
            variant="outline"
            className="h-10 shrink-0 px-4 text-label-md"
            disabled={checkOut.isPending}
            onClick={() => checkOut.mutate(currentSession.id)}
          >
            {checkOut.isPending ? 'Please wait…' : 'Check out'}
          </Button>
        </Card>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SHIFTS.map(({ period, label }) => (
          <ShiftCard
            key={period}
            label={label}
            session={openSessionByShift[period]}
            ended={endedShiftsToday.has(period)}
            checkingIn={checkIn.isPending && checkIn.variables?.shiftPeriod === period}
            checkingOut={checkOut.isPending && checkOut.variables === openSessionByShift[period]?.id}
            onCheckIn={() => requestCheckIn(period)}
            onCheckOut={(id) => checkOut.mutate(id)}
          />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="flex h-24 flex-col justify-between p-4">
          <span className="text-label-md text-on-surface-variant uppercase">Today's Hours (Both Shifts)</span>
          <span className="mt-auto text-headline-md font-bold text-on-surface">{formatDuration(todaysMinutes)}</span>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-title-lg text-on-surface">Today's Schedule</h2>
        {scheduleQuery.isLoading ? (
          <p className="text-body-md text-on-surface-variant">Loading…</p>
        ) : (scheduleQuery.data ?? []).length === 0 ? (
          <p className="text-body-md text-on-surface-variant">No students assigned to you today.</p>
        ) : (
          <div className="flex flex-col gap-6">
            {SHIFTS.map(({ period, label }) => {
              const items = itemsForShift(scheduleQuery.data ?? [], period)
              const isOpenShift = Boolean(openSessionByShift[period])
              return (
                <div key={period} className="flex flex-col gap-3">
                  <h3 className="text-title-md text-secondary">
                    {label} ({items.length} {items.length === 1 ? 'student' : 'students'})
                  </h3>
                  {items.length === 0 && (
                    <p className="text-body-md text-on-surface-variant">No students assigned for this shift.</p>
                  )}
                  {items.length > 0 && !isOpenShift && (
                    <p className="text-label-md text-on-surface-variant">
                      {endedShiftsToday.has(period)
                        ? 'This shift has ended. You can still view it, but pickup and drop-off actions are off.'
                        : `You are not checked into ${shiftName(period)}. You can view these students, but pickup and drop-off actions stay off until you check in.`}
                    </p>
                  )}
                  {items.map((item) => {
                    const rowKey = `${item.assignment_id}|${period}`
                    const type = rowType[rowKey] ?? 'pickup'
                    const skip = item.override?.skip ?? false
                    const effectivePickup = item.override?.pickup_time ?? item.pickup_time
                    const effectiveDropoff = item.override?.dropoff_time ?? item.dropoff_time
                    const pickupChanged = Boolean(item.override?.pickup_time) && item.override!.pickup_time !== item.pickup_time
                    const dropoffChanged = Boolean(item.override?.dropoff_time) && item.override!.dropoff_time !== item.dropoff_time
                    const loggedToday = todaysTrips.filter((t) => t.student_id === item.student.id && t.shift_period === period)
                    const alreadyLogged = loggedToday.some((t) => t.trip_type === type)
                    const openSession = openSessionByShift[period]
                    const shiftEnded = endedShiftsToday.has(period)
                    const noShowReported = item.no_show_reported[period]
                    const parentSkipped = item.parent_skipped[period]

                    return (
                      <Card key={rowKey} className="flex flex-col gap-3 p-4">
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
                              {item.student.parent_name ?? '-'}{' '}
                              {item.student.parent_phone ? (
                                <>
                                  · <ContactLink type="phone" value={item.student.parent_phone} />
                                </>
                              ) : (
                                ''
                              )}
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

                        {parentSkipped && (
                          <p className="rounded-lg bg-secondary-container px-3 py-2 text-label-md text-on-secondary-container">
                            Parent skipped {period} pickup for this student today, no pickup needed.
                          </p>
                        )}

                        <div className="flex items-center gap-2">
                          {(['pickup', 'dropoff'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              disabled={!openSession}
                              onClick={() => setRowType((prev) => ({ ...prev, [rowKey]: t }))}
                              className={`flex-1 rounded-lg border px-4 py-2 text-label-md capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
                            onClick={() => logTrip.mutate({ studentId: item.student.id, tripType: type, shiftPeriod: period })}
                          >
                            {!openSession ? (shiftEnded ? 'Shift ended' : 'Check in first') : alreadyLogged ? 'Already logged' : 'Confirm'}
                          </Button>
                        </div>

                        {(type === 'pickup' || !openSession) && (
                          <Button
                            variant="outline"
                            // Reported state gets the same danger color School Hub's "Driver reported
                            // no-show" badge uses, instead of just generic disabled-grey, so this reads
                            // as a real status, not "this button happens to be off right now."
                            className={`h-10 w-fit px-4 text-label-md ${noShowReported ? '!border-danger !text-danger disabled:!opacity-100' : ''}`}
                            disabled={
                              !openSession ||
                              markAbsent.isPending ||
                              noShowReported ||
                              parentSkipped ||
                              loggedToday.some((t) => t.trip_type === 'pickup')
                            }
                            onClick={() => markAbsent.mutate({ assignmentId: item.assignment_id, shiftPeriod: period })}
                          >
                            <span className="material-symbols-outlined !text-[18px]">person_off</span>
                            {noShowReported ? 'Absence Reported' : markAbsent.isPending ? 'Reporting…' : 'Mark Absent'}
                          </Button>
                        )}

                        {loggedToday.length > 0 && (
                          <div className="flex gap-3 text-label-md text-on-surface-variant">
                            {loggedToday.map((t) => (
                              <span key={t.id} className="flex items-center gap-1">
                                <span className="material-symbols-outlined !text-[16px] text-success">check_circle</span>
                                {t.trip_type} logged at {formatClock(t.created_at)}
                              </span>
                            ))}
                          </div>
                        )}
                      </Card>
                    )
                  })}
                </div>
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
                    {trip.trip_type}: {studentName(trip.student_id)}
                    {trip.shift_period && <span className="ml-2 text-label-md capitalize text-on-surface-variant">({trip.shift_period})</span>}
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

      {pendingSwitch && (
        <Modal title="Switch shifts?" onClose={() => setPendingSwitch(null)}>
          <p className="text-body-md text-on-surface">
            {currentSession?.shift_period
              ? `You are currently checked into ${shiftName(currentSession.shift_period)}.`
              : 'You are currently checked into a shift that started before the update.'}{' '}
            Checking into {shiftName(pendingSwitch)} will check you out of it, and you won&apos;t be able to return to it.
            Continue?
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" className="h-10 px-4 text-label-md" onClick={() => setPendingSwitch(null)}>
              Cancel
            </Button>
            <Button
              className="h-10 px-4 text-label-md"
              disabled={checkIn.isPending}
              onClick={() => {
                checkIn.mutate({ shiftPeriod: pendingSwitch, confirmSwitch: true })
                setPendingSwitch(null)
              }}
            >
              Continue
            </Button>
          </div>
        </Modal>
      )}

      {detailStudentId && (
        <StudentDetailModal studentId={detailStudentId} trips={tripsQuery.data ?? []} onClose={() => setDetailStudentId(null)} />
      )}
      {detailSchoolId && <SchoolDetailModal schoolId={detailSchoolId} onClose={() => setDetailSchoolId(null)} />}
    </div>
  )
}

// One check-in/check-out block per shift. Only one shift can be open at a time; a shift
// already worked today shows as ended and can't be checked into again.
function ShiftCard({
  label,
  session,
  ended,
  checkingIn,
  checkingOut,
  onCheckIn,
  onCheckOut,
}: {
  label: string
  session: DriverSession | undefined
  ended: boolean
  checkingIn: boolean
  checkingOut: boolean
  onCheckIn: () => void
  onCheckOut: (id: string) => void
}) {
  const pending = checkingIn || checkingOut
  const elapsedMinutes = session ? Math.max(0, (Date.now() - new Date(session.check_in_at).getTime()) / 60_000) : 0

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-title-lg text-on-surface">{label}</h2>
        {session ? (
          <StatusBadge tone="success" label="Checked In" pulse />
        ) : (
          <StatusBadge tone="neutral" label={ended ? 'Shift Ended' : 'Checked Out'} />
        )}
      </div>
      {/* The one primary action of a driver's whole day — the only button in the app that
          keeps the large treatment (size="lg"), everything else was normalized down tonight. */}
      <Button
        size="lg"
        className="w-full"
        onClick={() => (session ? onCheckOut(session.id) : onCheckIn())}
        disabled={pending || (ended && !session)}
      >
        <span className="material-symbols-outlined text-[24px]">{session ? 'logout' : 'login'}</span>
        <span>{pending ? 'Please wait…' : session ? 'Check out' : ended ? 'Shift ended' : 'Check in'}</span>
      </Button>
      {session && <span className="text-body-md text-on-surface-variant">{formatDuration(elapsedMinutes)} so far</span>}
    </Card>
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
            <dd>{s.grade ?? '-'}</dd>
            <dt className="text-on-surface-variant">Age</dt>
            <dd>{s.age ?? '-'}</dd>
            <dt className="text-on-surface-variant">Address</dt>
            <dd>{s.street_address ? `${s.street_address}, ${s.city}, ${s.state} ${s.zip_code}` : '-'}</dd>
            <dt className="text-on-surface-variant">Parent/Guardian</dt>
            <dd>{s.parent_name ?? '-'}</dd>
            <dt className="text-on-surface-variant">Parent Phone</dt>
            <dd>
              <ContactLink type="phone" value={s.parent_phone} />
            </dd>
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
                    {c.phone ? (
                      <>
                        {' · '}
                        <ContactLink type="phone" value={c.phone} />
                      </>
                    ) : (
                      ''
                    )}
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
          <dd>{s.address ?? '-'}</dd>
          <dt className="text-on-surface-variant">State/Zip</dt>
          <dd>
            {s.state ?? '-'} {s.zip_code ?? ''}
          </dd>
          <dt className="text-on-surface-variant">Phone</dt>
          <dd>
            <ContactLink type="phone" value={s.phone} />
          </dd>
          <dt className="text-on-surface-variant">Hours</dt>
          <dd>{s.hours ?? '-'}</dd>
          <dt className="text-on-surface-variant">Website</dt>
          <dd>{s.website ?? '-'}</dd>
        </dl>
      )}
    </Modal>
  )
}
