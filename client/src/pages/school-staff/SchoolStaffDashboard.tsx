import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatClock } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'
import { ContactLink } from '../../components/ContactLink'
import type { Student, Trip } from '../../types/api'

// School Staff dashboard (§7.4): view granted students, and confirm custody for their
// pending trips — the staff half of the two-way driver/staff confirmation handshake.
// Driver contact (name + phone, enriched server-side via Trips — see services/trips.js)
// is shown alongside each pending confirmation so staff know who they're handing off to.
export function SchoolStaffDashboard() {
  const queryClient = useQueryClient()

  // Both endpoints are now scoped to this staff member's GRANTED students only.
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const tripsQuery = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })

  const studentName = useMemo(() => {
    const map = new Map((studentsQuery.data ?? []).map((s) => [s.id, s.full_name]))
    return (id: string) => map.get(id) ?? 'Unknown student'
  }, [studentsQuery.data])

  const confirm = useMutation({
    mutationFn: (tripId: string) => api.post<Trip>(`/trips/${tripId}/confirm`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['trips'] }),
  })

  const pendingTrips = useMemo(
    () => (tripsQuery.data ?? []).filter((t) => t.status === 'pending').sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [tripsQuery.data],
  )

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">My Students</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-7">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Pending Custody Confirmations</h2>
          </CardHeader>
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
                      {trip.trip_type} — {studentName(trip.student_id)}
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
            <h2 className="text-title-lg text-primary">Granted Students</h2>
          </CardHeader>
          {(studentsQuery.data ?? []).length === 0 ? (
            <p className="p-6 text-body-md text-on-surface-variant">
              {studentsQuery.isLoading ? 'Loading…' : "You haven't been granted access to any students yet."}
            </p>
          ) : (
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  <th className="px-6 py-2 text-label-md text-secondary uppercase">Student</th>
                  <th className="px-6 py-2 text-label-md text-secondary uppercase">Grade</th>
                  <th className="px-6 py-2 text-label-md text-secondary uppercase">Parent/Guardian</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(studentsQuery.data ?? []).map((s) => (
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  )
}
