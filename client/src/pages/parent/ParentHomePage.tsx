import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import type { Student, SkipStatus } from '../../types/api'

// Real, minimal Parent home page — not the mockup. The full visual design (vehicle info,
// trip timeline, route map, driver contact) is still in review as a static mockup, see
// client/src/mockups/parent-dashboard/. This page is what a real parent account actually
// lands on today: real linked students + the one feature the task called out as needing to
// be genuinely real (not mocked) — Skip Today's Pickup, including its notification send.
export function ParentHomePage() {
  const [message, setMessage] = useState<string | null>(null)

  const studentsQuery = useQuery({ queryKey: ['parent-students'], queryFn: () => api.get<Student[]>('/parent/students') })

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">My Students</h1>
      <p className="text-body-md text-on-surface-variant">
        The full dashboard design (vehicle info, live route, trip timeline) is still being finalized — this page shows
        your real linked students and the working Skip Today's Pickup action.
      </p>

      {message && (
        <p className="rounded-lg bg-secondary-container px-4 py-2 text-body-md text-on-secondary-container">{message}</p>
      )}

      {studentsQuery.isLoading ? (
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      ) : (studentsQuery.data ?? []).length === 0 ? (
        <p className="text-body-md text-on-surface-variant">
          No students are linked to your account yet — ask your transportation company's admin to link one.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {(studentsQuery.data ?? []).map((s) => (
            <StudentCard key={s.id} student={s} onSkipped={(msg) => setMessage(msg)} />
          ))}
        </div>
      )}
    </div>
  )
}

function StudentCard({ student, onSkipped }: { student: Student; onSkipped: (msg: string) => void }) {
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: ['skip-status', student.id],
    queryFn: () => api.get<SkipStatus>(`/parent/students/${student.id}/skip-status`),
  })

  const skip = useMutation({
    mutationFn: () => api.post<{ skipped: boolean; notified: string[] }>(`/parent/students/${student.id}/skip-pickup`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['skip-status', student.id] })
      onSkipped(`Skipped today's pickup for ${student.full_name} — notified ${res.notified.length} people.`)
    },
    onError: (err) => onSkipped(err instanceof ApiError ? err.message : 'Could not skip pickup.'),
  })

  const eligible = statusQuery.data?.eligible ?? false

  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-title-lg text-primary">{student.full_name}</h2>
      {statusQuery.isLoading ? (
        <p className="text-body-md text-on-surface-variant">Checking today's schedule…</p>
      ) : (
        <>
          <p className="text-body-md text-on-surface-variant">
            {statusQuery.data?.pickupTime
              ? `Today's pickup: ${statusQuery.data.pickupTime.slice(0, 5)}`
              : 'No pickup scheduled today.'}
          </p>
          <Button
            variant={eligible ? 'primary' : 'outline'}
            disabled={!eligible || skip.isPending}
            className="w-fit px-6"
            onClick={() => skip.mutate()}
          >
            {skip.isPending
              ? 'Skipping…'
              : statusQuery.data?.alreadySkipped
                ? "Today's Pickup Skipped"
                : eligible
                  ? "Skip Today's Pickup"
                  : (statusQuery.data?.reason ?? 'Skip Unavailable')}
          </Button>
        </>
      )}
    </Card>
  )
}
