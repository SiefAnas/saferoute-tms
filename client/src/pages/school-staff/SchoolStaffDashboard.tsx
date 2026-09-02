import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatClock } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { StatusBadge } from '../../components/StatusBadge'
import { ContactLink } from '../../components/ContactLink'
import type { AbsentTodayEntry, ScheduleChange, ScheduleChangeType, Student, Trip } from '../../types/api'

// School pickup-confirmation dashboard (§7.4, extended 2026-09-02 for the pickup-confirmation
// task) — shared by BOTH school_staff and school_admin (mounted at /school-staff and
// /school-admin/pickup, same component either way). Role difference is entirely server-side:
// school_staff's reads/writes are narrowed to their granted students (staff_student_access
// sub-scope); school_admin sees/acts on the whole school. No client-side role branching needed.
//
// Three pieces:
//  1. Pending custody confirmations — the staff/admin half of the existing driver<->staff
//     two-way trip confirmation (trips.js), now open to school_admin too. The "auto-confirm
//     after 5 minutes if nobody confirms" behavior already exists (services/trips.js's
//     autoCompleteStaleTrips sweep) — nothing new needed for that part, just the role gate.
//  2. Absent Today — read-only surfacing of the EXISTING Skip Pickup (parent) / Mark Absent
//     (driver) signals, not a new absence system.
//  3. Schedule changes — "left early" / "staying later" logging, per student.
export function SchoolStaffDashboard() {
  const queryClient = useQueryClient()

  // Both endpoints are scoped server-side: school_staff -> granted students only,
  // school_admin -> the whole school.
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const tripsQuery = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })
  const absentQuery = useQuery({ queryKey: ['absent-today'], queryFn: () => api.get<AbsentTodayEntry[]>('/dashboard/absent-today') })
  const changesQuery = useQuery({ queryKey: ['schedule-changes'], queryFn: () => api.get<ScheduleChange[]>('/schedule-changes') })

  const studentName = useMemo(() => {
    const map = new Map((studentsQuery.data ?? []).map((s) => [s.id, s.full_name]))
    return (id: string) => map.get(id) ?? 'Unknown student'
  }, [studentsQuery.data])

  const absentByStudent = useMemo(() => {
    const map = new Map<string, AbsentTodayEntry>()
    for (const e of absentQuery.data ?? []) if (!map.has(e.student_id)) map.set(e.student_id, e)
    return map
  }, [absentQuery.data])

  const confirm = useMutation({
    mutationFn: (tripId: string) => api.post<Trip>(`/trips/${tripId}/confirm`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
  })

  const pendingTrips = useMemo(
    () => (tripsQuery.data ?? []).filter((t) => t.status === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [tripsQuery.data],
  )

  const [changeStudent, setChangeStudent] = useState<Student | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Today's Pickup & Dropoff</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-7">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Pending Confirmations</h2>
          </CardHeader>
          <p className="px-6 pt-4 text-label-md text-on-surface-variant">
            Morning: confirm a student was received at school. Afternoon: confirm a student was received by their
            driver for pickup. Unconfirmed after 5 minutes, this auto-confirms for now (temporary — see code TODO).
          </p>
          {pendingTrips.length === 0 ? (
            <p className="p-6 text-body-md text-on-surface-variant">
              {tripsQuery.isLoading ? 'Loading…' : 'Nothing awaiting confirmation.'}
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-outline-variant">
              {pendingTrips.map((trip) => (
                <div key={trip.id} className="flex items-center gap-4 p-4">
                  <div className="flex flex-col items-center">
                    <span className="text-headline-md font-bold text-primary">{formatClock(trip.created_at)}</span>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-title-lg capitalize">
                      {trip.trip_type === 'dropoff' ? 'Received at school' : 'Received by driver'} — {studentName(trip.student_id)}
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
                    {confirm.isError && confirm.variables === trip.id && (
                      <p className="mt-1 text-body-md text-error">
                        {confirm.error instanceof ApiError ? confirm.error.message : 'Could not confirm.'}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    disabled={confirm.isPending}
                    onClick={() => confirm.mutate(trip.id)}
                  >
                    {confirm.isPending && confirm.variables === trip.id ? 'Confirming…' : 'Confirm'}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-5">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Absent Today</h2>
          </CardHeader>
          <p className="px-6 pt-4 text-label-md text-on-surface-variant">
            Students whose pickup was skipped by a parent, or reported as a no-show by a driver — not expected today.
          </p>
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
          {(studentsQuery.data ?? []).length === 0 ? (
            <p className="p-6 text-body-md text-on-surface-variant">
              {studentsQuery.isLoading ? 'Loading…' : 'No students yet.'}
            </p>
          ) : (
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  <th className="px-6 py-2 text-label-md text-secondary uppercase">Student</th>
                  <th className="px-6 py-2 text-label-md text-secondary uppercase">Grade</th>
                  <th className="px-6 py-2 text-label-md text-secondary uppercase">Parent/Guardian</th>
                  <th className="px-6 py-2 text-label-md text-secondary uppercase">Today</th>
                  <th className="px-6 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(studentsQuery.data ?? []).map((s) => {
                  const absent = absentByStudent.get(s.id)
                  return (
                    <tr key={s.id}>
                      <td className="px-6 py-3 text-body-md font-medium">{s.full_name}</td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{s.grade ?? '—'}</td>
                      <td className="px-6 py-3 text-body-md text-on-surface-variant">
                        {s.parent_name ?? '—'}{' '}
                        {s.parent_phone ? (
                          <>
                            · <ContactLink type="phone" value={s.parent_phone} />
                          </>
                        ) : (
                          ''
                        )}
                      </td>
                      <td className="px-6 py-3">
                        {absent ? (
                          <StatusBadge
                            tone={absent.type === 'parent_skipped' ? 'neutral' : 'error'}
                            label={absent.type === 'parent_skipped' ? 'Skipped' : 'No-show'}
                          />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setChangeStudent(s)}
                          className="text-label-md text-primary hover:underline"
                        >
                          Log change
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
                    {' — '}
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
    </div>
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
    <Modal title={`Log Schedule Change — ${student.full_name}`} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2 text-body-md">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={changeType === 'left_early'} onChange={() => setChangeType('left_early')} />
            <span>
              <strong>Left early</strong> — parent already picked up. Cancels today's scheduled company pickup for
              this student.
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="radio" checked={changeType === 'staying_later'} onChange={() => setChangeType('staying_later')} />
            <span>
              <strong>Staying later</strong> — just a heads-up. Does not change the scheduled pickup time.
            </span>
          </label>
        </div>
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
