import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import type { Assignment, PublicUser, Student, Van } from '../../types/api'

// Company Admin — Assignments (§6 frontend gap): which driver+van is assigned to which
// student. GET /assignments returns raw ids only, so names are joined client-side against
// the students/drivers/vans already fetched for this page (same join pattern as
// CompanyAdminDashboard's driverRows).
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
  const [formError, setFormError] = useState<string | null>(null)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['assignments'] })

  const createAssignment = useMutation({
    mutationFn: () =>
      api.post<Assignment>('/assignments', {
        student_id: studentId,
        driver_user_id: driverId,
        van_id: vanId,
        start_date: startDate,
      }),
    onSuccess: () => {
      invalidate()
      setStudentId('')
      setDriverId('')
      setVanId('')
      setStartDate('')
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

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    createAssignment.mutate()
  }

  const selectClass =
    'h-14 w-full rounded-lg border border-outline bg-surface-container-lowest px-4 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20'

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
                  {['Student', 'Driver', 'Van', 'Start', 'End', ''].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(assignmentsQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {assignmentsQuery.isLoading ? 'Loading…' : 'No assignments yet.'}
                    </td>
                  </tr>
                ) : (
                  (assignmentsQuery.data ?? []).map((a) => {
                    const active = !a.end_date || new Date(a.end_date) >= new Date()
                    return (
                      <tr key={a.id} className="hover:bg-surface-container-low">
                        <td className="px-6 py-3 text-body-md font-medium">
                          {studentsById.get(a.student_id)?.full_name ?? a.student_id}
                        </td>
                        <td className="px-6 py-3 text-body-md text-on-surface-variant">
                          {driversById.get(a.driver_user_id)?.full_name ?? a.driver_user_id}
                        </td>
                        <td className="px-6 py-3 text-data-mono text-secondary">
                          {vansById.get(a.van_id)?.license_plate ?? a.van_id}
                        </td>
                        <td className="px-6 py-3 text-data-mono text-secondary">{a.start_date}</td>
                        <td className="px-6 py-3 text-data-mono text-secondary">{a.end_date ?? '—'}</td>
                        <td className="px-6 py-3 text-right">
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
                      </tr>
                    )
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
