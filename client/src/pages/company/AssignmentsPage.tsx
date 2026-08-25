import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { formatTimeOfDay } from '../../lib/format'
import type { Assignment, PublicUser, ScheduleOverride, Student, Van } from '../../types/api'

// Company Admin — Assignments (§6 frontend gap): which driver+van is assigned to which
// student. GET /assignments returns raw ids only, so names are joined client-side against
// the students/drivers/vans already fetched for this page (same join pattern as
// CompanyAdminDashboard's driverRows).
//
// Extended for the Driver dashboard rework: a usual pickup_time/dropoff_time per
// assignment (inline-edited per row, since student/driver/van/start_date aren't editable
// anyway — a full side-form edit switch isn't needed for just two fields), plus a per-row
// "Schedule overrides" panel for one-off date exceptions (different time and/or a skip).
export function AssignmentsPage() {
  const queryClient = useQueryClient()
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })

  const studentsById = useMemo(() => new Map((studentsQuery.data ?? []).map((s) => [s.id, s])), [studentsQuery.data])
  const driversById = useMemo(() => new Map((driversQuery.data ?? []).map((d) => [d.id, d])), [driversQuery.data])
  const vansById = useMemo(() => new Map((vansQuery.data ?? []).map((v) => [v.id, v])), [vansQuery.data])

  const [studentId, setStudentId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [vanId, setVanId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [pickupTime, setPickupTime] = useState('')
  const [dropoffTime, setDropoffTime] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const [editingTimesId, setEditingTimesId] = useState<string | null>(null)
  const [editPickup, setEditPickup] = useState('')
  const [editDropoff, setEditDropoff] = useState('')
  const [expandedOverridesId, setExpandedOverridesId] = useState<string | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['assignments'] })

  const createAssignment = useMutation({
    mutationFn: () =>
      api.post<Assignment>('/assignments', {
        student_id: studentId,
        driver_user_id: driverId,
        van_id: vanId,
        start_date: startDate,
        pickup_time: pickupTime || undefined,
        dropoff_time: dropoffTime || undefined,
      }),
    onSuccess: () => {
      invalidate()
      setStudentId('')
      setDriverId('')
      setVanId('')
      setStartDate('')
      setPickupTime('')
      setDropoffTime('')
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not create assignment.'),
  })

  const endAssignment = useMutation({
    mutationFn: (id: string) => api.patch<Assignment>(`/assignments/${id}`, { end_date: new Date().toISOString().slice(0, 10) }),
    onSuccess: invalidate,
  })

  const deleteAssignment = useMutation({
    mutationFn: (id: string) => api.delete(`/assignments/${id}`),
    onSuccess: invalidate,
  })

  const updateTimes = useMutation({
    mutationFn: (id: string) => api.patch<Assignment>(`/assignments/${id}`, { pickup_time: editPickup || null, dropoff_time: editDropoff || null }),
    onSuccess: () => {
      invalidate()
      setEditingTimesId(null)
    },
  })

  function startEditTimes(a: Assignment) {
    setEditingTimesId(a.id)
    setEditPickup(a.pickup_time ? a.pickup_time.slice(0, 5) : '')
    setEditDropoff(a.dropoff_time ? a.dropoff_time.slice(0, 5) : '')
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    createAssignment.mutate()
  }

  const selectClass =
    'h-14 w-full rounded-lg border border-outline bg-surface-container-lowest px-4 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20'
  const timeInputClass =
    'h-10 rounded-lg border border-outline bg-surface-container-lowest px-2 text-body-md outline-none focus:border-primary-container'

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Assignments</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Student → Driver / Van</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  {['Student', 'Driver', 'Van', 'Start', 'End', 'Pickup', 'Dropoff', ''].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(assignmentsQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {assignmentsQuery.isLoading ? 'Loading…' : 'No assignments yet.'}
                    </td>
                  </tr>
                ) : (
                  (assignmentsQuery.data ?? []).flatMap((a) => {
                    const active = !a.end_date || new Date(a.end_date) >= new Date()
                    const editingTimes = editingTimesId === a.id
                    const rows = [
                      <tr key={a.id} className="hover:bg-surface-container-low">
                        <td className="px-6 py-3 text-body-md font-medium">
                          {studentsQuery.isLoading ? '…' : (studentsById.get(a.student_id)?.full_name ?? '(deleted student)')}
                        </td>
                        <td className="px-6 py-3 text-body-md text-on-surface-variant">
                          {driversQuery.isLoading ? '…' : (driversById.get(a.driver_user_id)?.full_name ?? '(deleted driver)')}
                        </td>
                        <td className="px-6 py-3 text-data-mono text-secondary">
                          {vansQuery.isLoading ? '…' : (vansById.get(a.van_id)?.license_plate ?? '(deleted van)')}
                        </td>
                        <td className="px-6 py-3 text-data-mono text-secondary">{a.start_date}</td>
                        <td className="px-6 py-3 text-data-mono text-secondary">{a.end_date ?? '—'}</td>
                        {editingTimes ? (
                          <>
                            <td className="px-6 py-3">
                              <input type="time" value={editPickup} onChange={(e) => setEditPickup(e.target.value)} className={timeInputClass} />
                            </td>
                            <td className="px-6 py-3">
                              <input type="time" value={editDropoff} onChange={(e) => setEditDropoff(e.target.value)} className={timeInputClass} />
                            </td>
                          </>
                        ) : (
                          <>
                            <td className="px-6 py-3 text-data-mono text-secondary">{formatTimeOfDay(a.pickup_time)}</td>
                            <td className="px-6 py-3 text-data-mono text-secondary">{formatTimeOfDay(a.dropoff_time)}</td>
                          </>
                        )}
                        <td className="px-6 py-3 text-right whitespace-nowrap">
                          {editingTimes ? (
                            <>
                              <button
                                type="button"
                                onClick={() => updateTimes.mutate(a.id)}
                                disabled={updateTimes.isPending}
                                className="mr-3 text-label-md text-primary hover:underline"
                              >
                                Save
                              </button>
                              <button type="button" onClick={() => setEditingTimesId(null)} className="mr-3 text-label-md text-on-surface-variant hover:underline">
                                Cancel
                              </button>
                            </>
                          ) : (
                            <button type="button" onClick={() => startEditTimes(a)} className="mr-3 text-label-md text-primary hover:underline">
                              Edit times
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setExpandedOverridesId(expandedOverridesId === a.id ? null : a.id)}
                            className="mr-3 text-label-md text-secondary hover:underline"
                          >
                            Overrides
                          </button>
                          {active && (
                            <button
                              type="button"
                              onClick={() => endAssignment.mutate(a.id)}
                              disabled={endAssignment.isPending}
                              className="mr-3 text-label-md text-primary hover:underline disabled:opacity-50"
                            >
                              End Today
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => deleteAssignment.mutate(a.id)}
                            disabled={deleteAssignment.isPending}
                            className="text-label-md text-error hover:underline disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>,
                    ]
                    if (expandedOverridesId === a.id) {
                      rows.push(
                        <tr key={`${a.id}-overrides`}>
                          <td colSpan={8} className="bg-surface-container-low px-6 py-4">
                            <OverridesPanel assignmentId={a.id} />
                          </td>
                        </tr>,
                      )
                    }
                    return rows
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="col-span-12 p-5 lg:col-span-4">
          <h2 className="mb-3 text-title-lg text-primary">New Assignment</h2>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <select required value={studentId} onChange={(e) => setStudentId(e.target.value)} className={selectClass}>
              <option value="">Select a student…</option>
              {(studentsQuery.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name}
                </option>
              ))}
            </select>
            <select required value={driverId} onChange={(e) => setDriverId(e.target.value)} className={selectClass}>
              <option value="">Select a driver…</option>
              {(driversQuery.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
            <select required value={vanId} onChange={(e) => setVanId(e.target.value)} className={selectClass}>
              <option value="">Select a van…</option>
              {(vansQuery.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.license_plate}
                </option>
              ))}
            </select>
            <input
              required
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="h-14 w-full rounded-lg border border-outline bg-surface-container-lowest px-4 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
            />
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-label-md text-on-surface-variant">Usual pickup time</label>
                <input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className={`${timeInputClass} w-full`} />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-label-md text-on-surface-variant">Usual dropoff time</label>
                <input type="time" value={dropoffTime} onChange={(e) => setDropoffTime(e.target.value)} className={`${timeInputClass} w-full`} />
              </div>
            </div>
            <Button type="submit" variant="secondary" disabled={createAssignment.isPending}>
              {createAssignment.isPending ? 'Creating…' : 'Create Assignment'}
            </Button>
            {formError && (
              <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
                {formError}
              </p>
            )}
          </form>
        </Card>
      </div>
    </div>
  )
}

function OverridesPanel({ assignmentId }: { assignmentId: string }) {
  const queryClient = useQueryClient()
  const overridesQuery = useQuery({
    queryKey: ['assignment-overrides', assignmentId],
    queryFn: () => api.get<ScheduleOverride[]>(`/assignments/${assignmentId}/overrides`),
  })
  const [date, setDate] = useState('')
  const [pickup, setPickup] = useState('')
  const [dropoff, setDropoff] = useState('')
  const [skip, setSkip] = useState(false)
  const [note, setNote] = useState('')

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['assignment-overrides', assignmentId] })

  const addOverride = useMutation({
    mutationFn: () =>
      api.post<ScheduleOverride>(`/assignments/${assignmentId}/overrides`, {
        override_date: date,
        pickup_time: pickup || undefined,
        dropoff_time: dropoff || undefined,
        skip,
        note: note || undefined,
      }),
    onSuccess: () => {
      invalidate()
      setDate('')
      setPickup('')
      setDropoff('')
      setSkip(false)
      setNote('')
    },
  })

  const deleteOverride = useMutation({
    mutationFn: (id: string) => api.delete(`/assignments/${assignmentId}/overrides/${id}`),
    onSuccess: invalidate,
  })

  function handleAdd(e: FormEvent) {
    e.preventDefault()
    if (date) addOverride.mutate()
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-title-md text-primary">Schedule Overrides</h3>
      {overridesQuery.isLoading ? (
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      ) : (overridesQuery.data ?? []).length === 0 ? (
        <p className="text-body-md text-on-surface-variant">No overrides yet.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {(overridesQuery.data ?? []).map((o) => (
            <li key={o.id} className="flex items-center justify-between text-body-md">
              <span>
                {o.override_date}: {o.skip ? 'No pickup/dropoff' : `${formatTimeOfDay(o.pickup_time)} / ${formatTimeOfDay(o.dropoff_time)}`}
                {o.note ? ` — ${o.note}` : ''}
              </span>
              <button
                type="button"
                onClick={() => deleteOverride.mutate(o.id)}
                disabled={deleteOverride.isPending}
                className="text-label-md text-error hover:underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap items-end gap-2" onSubmit={handleAdd}>
        <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border border-outline bg-surface-container-lowest px-2 text-body-md outline-none" />
        <input type="time" value={pickup} onChange={(e) => setPickup(e.target.value)} disabled={skip} className="h-10 rounded-lg border border-outline bg-surface-container-lowest px-2 text-body-md outline-none disabled:opacity-50" />
        <input type="time" value={dropoff} onChange={(e) => setDropoff(e.target.value)} disabled={skip} className="h-10 rounded-lg border border-outline bg-surface-container-lowest px-2 text-body-md outline-none disabled:opacity-50" />
        <label className="flex items-center gap-1 text-label-md text-on-surface-variant">
          <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
          Skip
        </label>
        <Input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} className="h-10 w-40" />
        <Button type="submit" variant="outline" className="h-10 px-4 text-label-md" disabled={addOverride.isPending}>
          Add
        </Button>
      </form>
    </div>
  )
}
