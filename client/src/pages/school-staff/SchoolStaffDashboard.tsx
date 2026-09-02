import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatClock, isToday } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { StatusBadge } from '../../components/StatusBadge'
import { ContactLink } from '../../components/ContactLink'
import { InfoTooltip } from '../../components/InfoTooltip'
import type { AbsentTodayEntry, School, ScheduleChange, ScheduleChangeType, Student, StudentContact, Trip } from '../../types/api'

// Which trip_type is "relevant" for a student right now, i.e. which confirmation a school
// staff/admin would plausibly be doing at this moment: mornings, staff confirm the driver
// dropping a student off at school (trip_type 'pickup' — the driver's own toggle defaults to
// 'pickup' first thing in the day, matching assignments.pickup_time); afternoons, staff
// confirm handing the student off to the driver for the ride home (trip_type 'dropoff',
// matching assignments.dropoff_time). This is a simple wall-clock split (noon), not derived
// from the student's actual scheduled pickup/dropoff time — school_staff/school_admin have no
// endpoint that exposes per-student scheduled times today, and a simple AM/PM split matches
// what the task asked for ("whichever is relevant for that time of day") without adding one.
function relevantTripType(): 'pickup' | 'dropoff' {
  return new Date().getHours() < 12 ? 'pickup' : 'dropoff'
}

function tripTypeLabel(type: 'pickup' | 'dropoff'): string {
  return type === 'pickup' ? 'Received at school' : 'Received by driver'
}

// School pickup-confirmation dashboard (§7.4, extended 2026-09-02 for the pickup-confirmation
// task, revised the same day after live testing) — shared by BOTH school_staff and
// school_admin (mounted at /school-staff and /school-admin/pickup, same component either
// way). Role difference is entirely server-side: school_staff's reads/writes are narrowed to
// their granted students (staff_student_access sub-scope); school_admin sees/acts on the
// whole school. No client-side role branching needed.
//
// Three pieces:
//  1. Pending custody confirmations, PLUS clicking a student's name opens the confirm flow
//     directly for whichever leg (morning/afternoon) is relevant right now — the "Pending
//     Confirmations" list alone wasn't a discoverable enough entry point in live testing.
//  2. Absent Today — read-only surfacing of the EXISTING Skip Pickup (parent) / Mark Absent
//     (driver) signals, not a new absence system.
//  3. Schedule changes — "left early" / "staying later" logging, per student. Both types now
//     cancel today's scheduled pickup (they only differ in the reason logged/notified) — see
//     services/scheduleChanges.js's header comment for why.
export function SchoolStaffDashboard() {
  // Both endpoints are scoped server-side: school_staff -> granted students only,
  // school_admin -> the whole school.
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const tripsQuery = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })
  const absentQuery = useQuery({ queryKey: ['absent-today'], queryFn: () => api.get<AbsentTodayEntry[]>('/dashboard/absent-today') })
  const changesQuery = useQuery({ queryKey: ['schedule-changes'], queryFn: () => api.get<ScheduleChange[]>('/schedule-changes') })
  // Same school contact info for every row below (all these students share the caller's own
  // school) — fetched once here rather than per-row. One request either way: react-query
  // dedupes by queryKey, so even a per-row useQuery with this same key would only hit the
  // network once, but fetching it at the top keeps that fact from being implicit.
  const schoolQuery = useQuery({ queryKey: ['school-me'], queryFn: () => api.get<School>('/schools/me') })

  const studentName = useMemo(() => {
    const map = new Map((studentsQuery.data ?? []).map((s) => [s.id, s.full_name]))
    return (id: string) => map.get(id) ?? 'Unknown student'
  }, [studentsQuery.data])

  const absentByStudent = useMemo(() => {
    const map = new Map<string, AbsentTodayEntry>()
    for (const e of absentQuery.data ?? []) if (!map.has(e.student_id)) map.set(e.student_id, e)
    return map
  }, [absentQuery.data])

  const pendingTrips = useMemo(
    () => (tripsQuery.data ?? []).filter((t) => t.status === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [tripsQuery.data],
  )

  const [changeStudent, setChangeStudent] = useState<Student | null>(null)
  const [confirmStudent, setConfirmStudent] = useState<Student | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Today's Pickup & Dropoff</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-7">
          <CardHeader>
            <h2 className="flex items-center gap-1 text-title-lg text-primary">
              Pending Confirmations
              <InfoTooltip text="Morning: confirm a student was received at school. Afternoon: confirm a student was received by their driver for pickup. Unconfirmed after 5 minutes, this auto-confirms for now (temporary)." />
            </h2>
          </CardHeader>
          {pendingTrips.length === 0 ? (
            <p className="p-6 text-body-md text-on-surface-variant">
              {tripsQuery.isLoading ? 'Loading…' : 'Nothing awaiting confirmation.'}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-outline-variant">
              {pendingTrips.map((trip) => (
                <PendingTripRow key={trip.id} trip={trip} studentName={studentName(trip.student_id)} />
              ))}
            </div>
          )}
        </Card>

        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-5">
          <CardHeader>
            <h2 className="flex items-center gap-1 text-title-lg text-primary">
              Absent Today
              <InfoTooltip text="Students whose pickup was skipped by a parent, or reported as a no-show by a driver. Not expected today." />
            </h2>
          </CardHeader>
          {(absentQuery.data ?? []).length === 0 ? (
            <p className="p-6 text-body-md text-on-surface-variant">
              {absentQuery.isLoading ? 'Loading…' : 'No skips or no-shows reported today.'}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-outline-variant">
              {(absentQuery.data ?? []).map((e, i) => (
                <li key={`${e.student_id}-${i}`} className="flex items-center justify-between px-6 py-3">
                  <span className="text-body-md font-medium">{e.student_name}</span>
                  <StatusBadge
                    tone={e.type === 'parent_skipped' ? 'neutral' : 'error'}
                    label={e.type === 'parent_skipped' ? 'Skipped by parent' : 'Driver reported no-show'}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="col-span-12 flex flex-col overflow-hidden">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Students</h2>
          </CardHeader>
          <p className="px-6 pt-4 text-label-md text-on-surface-variant">Click a student's name to confirm pickup or dropoff.</p>
          {(studentsQuery.data ?? []).length === 0 ? (
            <p className="p-6 text-body-md text-on-surface-variant">
              {studentsQuery.isLoading ? 'Loading…' : 'No students yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-outline-variant bg-surface-container-low">
                  <tr>
                    <th className="px-6 py-2 text-label-md text-secondary uppercase">Student</th>
                    <th className="px-6 py-2 text-label-md text-secondary uppercase">Grade</th>
                    <th className="px-6 py-2 text-label-md text-secondary uppercase">Parent/Guardian</th>
                    <th className="px-6 py-2 text-label-md text-secondary uppercase">Company</th>
                    <th className="px-6 py-2 text-label-md text-secondary uppercase">Van</th>
                    <th className="px-6 py-2 text-label-md text-secondary uppercase">Today</th>
                    <th className="px-6 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-outline-variant">
                  {(studentsQuery.data ?? []).map((s) => (
                    <StudentRow
                      key={s.id}
                      student={s}
                      absent={absentByStudent.get(s.id)}
                      school={schoolQuery.data}
                      onConfirm={() => setConfirmStudent(s)}
                      onLogChange={() => setChangeStudent(s)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="col-span-12 flex flex-col overflow-hidden">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Today's Schedule Changes</h2>
          </CardHeader>
          {(changesQuery.data ?? []).length === 0 ? (
            <p className="p-6 text-body-md text-on-surface-variant">
              {changesQuery.isLoading ? 'Loading…' : 'No schedule changes logged today.'}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-outline-variant">
              {(changesQuery.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between px-6 py-3">
                  <span className="text-body-md">
                    <span className="font-medium">{studentName(c.student_id)}</span>
                    {': '}
                    {c.change_type === 'left_early' ? 'Left early' : 'Staying later'}
                    {c.note ? ` (${c.note})` : ''}
                  </span>
                  <span className="text-label-md text-on-surface-variant">{formatClock(c.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {changeStudent && <LogScheduleChangeModal student={changeStudent} onClose={() => setChangeStudent(null)} />}
      {confirmStudent && (
        <ConfirmTripModal
          student={confirmStudent}
          todaysTripsForStudent={(tripsQuery.data ?? []).filter((t) => t.student_id === confirmStudent.id && isToday(t.created_at))}
          onClose={() => setConfirmStudent(null)}
        />
      )}
    </div>
  )
}

function PendingTripRow({ trip, studentName }: { trip: Trip; studentName: string }) {
  const queryClient = useQueryClient()
  const confirm = useMutation({
    mutationFn: () => api.post<Trip>(`/trips/${trip.id}/confirm`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
  })

  return (
    <div className="flex items-center gap-4 p-4">
      <div className="flex flex-col items-center">
        <span className="text-headline-md font-bold text-primary">{formatClock(trip.created_at)}</span>
      </div>
      <div className="flex-1">
        <h3 className="text-title-lg">
          {tripTypeLabel(trip.trip_type)}: {studentName}
        </h3>
        <p className="text-body-md text-on-surface-variant">
          Driver: {trip.driver_name ?? 'Unknown'}
          {trip.driver_phone ? (
            <>
              {' · '}
              <ContactLink type="phone" value={trip.driver_phone} />
            </>
          ) : (
            ''
          )}
        </p>
        <StatusBadge tone="active" label="Awaiting your confirmation" pulse />
        {confirm.isError && (
          <p className="mt-1 text-body-md text-error">{confirm.error instanceof ApiError ? confirm.error.message : 'Could not confirm.'}</p>
        )}
      </div>
      <Button variant="secondary" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
        {confirm.isPending ? 'Confirming…' : 'Confirm'}
      </Button>
    </div>
  )
}

// One row of the Students table, plus its own expandable "More info" panel (§ School Hub
// student list task, 2026-09-02) — same compact-plus-expand pattern as the parent
// dashboard's student card (ParentHomePage.tsx), adapted to a table row: an extra <tr>
// beneath the main one, shown/hidden per-row rather than one page-level toggle.
// company_name/van/driver come from the student object itself (server already attaches
// them to every row for school_staff/school_admin reads — see students.js's
// attachTransportInfo), so showing them here costs no extra request. Only the additional
// parent/guardian contacts + home address are genuinely lazy: fetched via GET /students/:id
// on first expand, same as the rest of the app only fetches "more info" once asked for.
function StudentRow({
  student,
  absent,
  school,
  onConfirm,
  onLogChange,
}: {
  student: Student
  absent: AbsentTodayEntry | undefined
  school: School | undefined
  onConfirm: () => void
  onLogChange: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const detailQuery = useQuery({
    queryKey: ['student-detail', student.id],
    queryFn: () => api.get<Student>(`/students/${student.id}`),
    enabled: expanded,
  })
  const contacts: StudentContact[] = detailQuery.data?.contacts ?? []
  const homeAddress = detailQuery.data
    ? [detailQuery.data.street_address, detailQuery.data.city, detailQuery.data.state, detailQuery.data.zip_code]
        .filter(Boolean)
        .join(', ')
    : ''

  return (
    <>
      <tr>
        <td className="px-6 py-3 text-body-md font-medium whitespace-nowrap">
          <button type="button" onClick={onConfirm} className="text-primary hover:underline">
            {student.full_name}
          </button>
        </td>
        <td className="px-6 py-3 text-data-mono text-secondary">{student.grade ?? '-'}</td>
        <td className="px-6 py-3 text-body-md text-on-surface-variant whitespace-nowrap">
          {student.parent_name ?? '-'}{' '}
          {student.parent_phone ? (
            <>
              · <ContactLink type="phone" value={student.parent_phone} />
            </>
          ) : (
            ''
          )}
        </td>
        <td className="px-6 py-3 text-body-md text-on-surface-variant whitespace-nowrap">{student.company_name ?? '-'}</td>
        <td className="px-6 py-3 text-body-md text-on-surface-variant whitespace-nowrap">
          {student.van ? `${student.van.brand} ${student.van.model}` : '-'}
        </td>
        <td className="px-6 py-3">
          {absent ? (
            <StatusBadge
              tone={absent.type === 'parent_skipped' ? 'neutral' : 'error'}
              label={absent.type === 'parent_skipped' ? 'Skipped' : 'No-show'}
            />
          ) : (
            '-'
          )}
        </td>
        <td className="px-6 py-3 text-right whitespace-nowrap">
          <div className="flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-label-md text-primary hover:underline"
            >
              {expanded ? 'Less info' : 'More info'}
              <span className="material-symbols-outlined !text-[18px]">{expanded ? 'expand_less' : 'expand_more'}</span>
            </button>
            <button type="button" onClick={onLogChange} className="text-label-md text-primary hover:underline">
              Log change
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-surface-container-low px-6 py-4">
            {detailQuery.isLoading ? (
              <p className="text-body-md text-on-surface-variant">Loading…</p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <h4 className="mb-2 text-label-md text-secondary uppercase">Parent/Guardian</h4>
                  <p className="text-body-md text-on-surface">{student.parent_name ?? '-'}</p>
                  <p className="text-body-md text-on-surface-variant">
                    <ContactLink type="phone" value={student.parent_phone} />
                  </p>
                  {homeAddress && <p className="mt-1 text-body-md text-on-surface-variant">{homeAddress}</p>}
                  {contacts.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 border-t border-outline-variant pt-2">
                      {contacts.map((c) => (
                        <li key={c.id} className="text-body-md text-on-surface-variant">
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
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-label-md text-secondary uppercase">Van</h4>
                  {student.van ? (
                    <div className="flex flex-col gap-0.5 text-body-md text-on-surface-variant">
                      <p className="text-on-surface">
                        {student.van.brand} {student.van.model} ({student.van.year})
                      </p>
                      <p>Plate: {student.van.license_plate}</p>
                      <p>Color: {student.van.color ?? '-'}</p>
                    </div>
                  ) : (
                    <p className="text-body-md text-on-surface-variant">No van currently assigned.</p>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-label-md text-secondary uppercase">Driver</h4>
                  {student.driver ? (
                    <div className="flex flex-col gap-0.5 text-body-md text-on-surface-variant">
                      <p className="text-on-surface">{student.driver.full_name}</p>
                      <p>
                        <ContactLink type="phone" value={student.driver.phone} />
                      </p>
                    </div>
                  ) : (
                    <p className="text-body-md text-on-surface-variant">No driver currently assigned.</p>
                  )}
                </div>

                <div>
                  <h4 className="mb-2 text-label-md text-secondary uppercase">School</h4>
                  {school ? (
                    <div className="flex flex-col gap-0.5 text-body-md text-on-surface-variant">
                      <p className="text-on-surface">{school.name}</p>
                      <p>
                        <ContactLink type="phone" value={school.phone} />
                      </p>
                      <p>{school.address ?? '-'}</p>
                      {school.hours && <p>Hours: {school.hours}</p>}
                    </div>
                  ) : (
                    <p className="text-body-md text-on-surface-variant">-</p>
                  )}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

// The actual confirm action for a student, opened by clicking their name (§ pickup-
// confirmation task, item 1 — "Log change" existed but there was no visible way to do the
// real morning/afternoon confirmation). Reuses the existing trip-confirmation system as-is:
// this never creates or bypasses a trip, it only surfaces whatever's already there for
// whichever leg is relevant right now (see relevantTripType above) and, if it's pending,
// lets staff confirm it, same POST /trips/:id/confirm the Pending Confirmations list uses.
function ConfirmTripModal({
  student,
  todaysTripsForStudent,
  onClose,
}: {
  student: Student
  todaysTripsForStudent: Trip[]
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const type = relevantTripType()
  const trip = todaysTripsForStudent.find((t) => t.trip_type === type)

  const confirm = useMutation({
    mutationFn: () => api.post<Trip>(`/trips/${trip!.id}/confirm`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      onClose()
    },
  })

  return (
    <Modal title={`${tripTypeLabel(type)}: ${student.full_name}`} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {!trip ? (
          <p className="text-body-md text-on-surface-variant">
            The driver hasn't logged this {type === 'pickup' ? 'drop-off at school' : 'pickup from school'} yet. Check back once they
            have, it'll show up here and in Pending Confirmations.
          </p>
        ) : trip.status === 'complete' ? (
          <p className="text-body-md text-on-surface-variant">
            Already confirmed at {formatClock(trip.completed_at ?? trip.created_at)}
            {trip.auto_completed ? ' (auto-confirmed after 5 minutes)' : ''}.
          </p>
        ) : (
          <>
            <p className="text-body-md text-on-surface-variant">
              Driver: {trip.driver_name ?? 'Unknown'}
              {trip.driver_phone ? (
                <>
                  {' · '}
                  <ContactLink type="phone" value={trip.driver_phone} />
                </>
              ) : (
                ''
              )}
            </p>
            {confirm.isError && (
              <p className="text-body-md text-error">{confirm.error instanceof ApiError ? confirm.error.message : 'Could not confirm.'}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" disabled={confirm.isPending} onClick={() => confirm.mutate()}>
                {confirm.isPending ? 'Confirming…' : 'Confirm'}
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function LogScheduleChangeModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [changeType, setChangeType] = useState<ScheduleChangeType>('left_early')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const log = useMutation({
    mutationFn: () =>
      api.post<ScheduleChange & { notified: string[]; skipped_assignment_id: string | null }>(
        `/schedule-changes/students/${student.id}`,
        { change_type: changeType, note: note || undefined },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule-changes'] })
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not log this change.'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    log.mutate()
  }

  return (
    <Modal title={`Log Schedule Change: ${student.full_name}`} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2 text-body-md">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={changeType === 'left_early'} onChange={() => setChangeType('left_early')} />
            <span>
              <strong>Left early</strong> (parent already picked up)
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={changeType === 'staying_later'} onChange={() => setChangeType('staying_later')} />
            <span>
              <strong>Staying later</strong> (not leaving on the usual schedule)
            </span>
          </label>
        </div>
        <p className="text-label-md text-on-surface-variant">
          Either way, today's scheduled company pickup for this student is cancelled. Choose whichever reason applies.
        </p>
        <textarea
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full rounded-lg border border-outline bg-surface-container-lowest px-4 py-2 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
        />
        <p className="text-label-md text-on-surface-variant">
          Notifies the company admin, school admin, this student's assigned driver, and their parent(s).
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={log.isPending}>
            {log.isPending ? 'Logging…' : 'Log Change'}
          </Button>
        </div>
        {error && (
          <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
