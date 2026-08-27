import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatTimeOfDay, formatClock } from '../../lib/format'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'
import type { Student, SkipStatus, ParentStudentDetail } from '../../types/api'

// Real Parent dashboard (2026-08-27) — replaces the earlier "real, minimal" placeholder
// once the isolated design mockup (client/src/mockups/, now deleted — it was left
// unauthenticated on the live public site and had to come down) needed to become the real
// thing. Vehicle info, driver, and the trip timeline below are all sourced from real data
// (GET /parent/students/:id/detail) — no fake/placeholder values. The one thing NOT real
// yet: the route map is a static school-to-home illustration, not live GPS — TODO (v2).
export function ParentHomePage() {
  const [message, setMessage] = useState<string | null>(null)

  const studentsQuery = useQuery({ queryKey: ['parent-students'], queryFn: () => api.get<Student[]>('/parent/students') })

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">My Students</h1>

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
        <div className="flex flex-col gap-5">
          {(studentsQuery.data ?? []).map((s) => (
            <StudentSection key={s.id} student={s} onSkipped={(msg) => setMessage(msg)} />
          ))}
        </div>
      )}
    </div>
  )
}

function StudentSection({ student, onSkipped }: { student: Student; onSkipped: (msg: string) => void }) {
  const detailQuery = useQuery({
    queryKey: ['parent-student-detail', student.id],
    queryFn: () => api.get<ParentStudentDetail>(`/parent/students/${student.id}/detail`),
  })
  const d = detailQuery.data

  const pickupTrip = d?.trips_today.find((t) => t.trip_type === 'pickup')
  const dropoffTrip = d?.trips_today.find((t) => t.trip_type === 'dropoff')
  const pickupDone = pickupTrip?.status === 'complete'
  const dropoffDone = dropoffTrip?.status === 'complete'

  const status = d?.skip_today
    ? { tone: 'neutral' as const, label: 'Pickup Skipped Today' }
    : dropoffDone
      ? { tone: 'success' as const, label: 'Dropped Off' }
      : pickupDone
        ? { tone: 'active' as const, label: 'In Transit', pulse: true }
        : { tone: 'neutral' as const, label: 'Not Yet Picked Up' }

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title-lg text-on-surface">{student.full_name}</h2>
          <p className="text-body-md text-on-surface-variant">{d?.company.name ?? (detailQuery.isLoading ? '…' : '—')}</p>
        </div>
        <StatusBadge tone={status.tone} label={status.label} pulse={'pulse' in status ? status.pulse : false} />
      </div>

      {detailQuery.isLoading ? (
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      ) : !d?.van || !d?.driver ? (
        <p className="text-body-md text-on-surface-variant">No driver/van currently assigned to this student.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:grid-cols-5">
            {[
              ['Plate', d.van.license_plate],
              ['Brand', d.van.brand],
              ['Model', d.van.model],
              ['Year', String(d.van.year)],
              ['Color', d.van.color ?? '—'],
            ].map(([label, value]) => (
              <div key={label}>
                <p className="text-label-md text-on-surface-variant uppercase">{label}</p>
                <p className="text-body-md font-medium text-on-surface">{value}</p>
              </div>
            ))}
          </div>

          <TripTimeline pickupTrip={pickupTrip} dropoffTrip={dropoffTrip} pickupScheduled={d.pickup_time} dropoffScheduled={d.dropoff_time} />

          <div className="flex flex-wrap gap-3">
            <SkipPickupButton student={student} skipToday={d.skip_today} onSkipped={onSkipped} />
            {d.driver.phone && (
              <a href={`tel:${d.driver.phone}`} className="inline-flex">
                <Button variant="outline" className="px-6">
                  <span className="material-symbols-outlined">call</span>
                  Contact {d.driver.full_name.split(' ')[0]}
                </Button>
              </a>
            )}
          </div>

          <RouteMap />
        </>
      )}
    </Card>
  )
}

function TripTimeline({
  pickupTrip,
  dropoffTrip,
  pickupScheduled,
  dropoffScheduled,
}: {
  pickupTrip: ParentStudentDetail['trips_today'][number] | undefined
  dropoffTrip: ParentStudentDetail['trips_today'][number] | undefined
  pickupScheduled: string | null
  dropoffScheduled: string | null
}) {
  const pickupDone = pickupTrip?.status === 'complete'
  const dropoffDone = dropoffTrip?.status === 'complete'

  const steps = [
    {
      label: 'Picked Up',
      time: pickupDone && pickupTrip?.completed_at ? formatClock(pickupTrip.completed_at) : formatTimeOfDay(pickupScheduled),
      state: pickupDone ? ('done' as const) : ('upcoming' as const),
    },
    {
      label: 'In Transit',
      time: null,
      state: pickupDone && !dropoffDone ? ('current' as const) : pickupDone ? ('done' as const) : ('upcoming' as const),
    },
    {
      label: dropoffDone ? 'Dropped Off' : 'Drop-off (est.)',
      time: dropoffDone && dropoffTrip?.completed_at ? formatClock(dropoffTrip.completed_at) : formatTimeOfDay(dropoffScheduled),
      state: dropoffDone ? ('done' as const) : ('upcoming' as const),
    },
  ]

  return (
    <div className="flex flex-col gap-0">
      {steps.map((step, i) => (
        <div key={step.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            {step.state === 'done' ? (
              <span className="material-symbols-outlined flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 !text-[16px] text-white">
                check
              </span>
            ) : step.state === 'current' ? (
              <span className="flex h-6 w-6 items-center justify-center">
                <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
              </span>
            ) : (
              <span className="flex h-6 w-6 items-center justify-center">
                <span className="h-3 w-3 rounded-full bg-surface-container-highest" />
              </span>
            )}
            {i < steps.length - 1 && <span className="h-8 w-px bg-outline-variant" />}
          </div>
          <div className={`pb-2 ${step.state === 'upcoming' ? 'text-on-surface-variant opacity-60' : 'text-on-surface'}`}>
            <p className="text-body-md font-medium">{step.label}</p>
            {step.time && <p className="text-label-md">{step.time}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function SkipPickupButton({
  student,
  skipToday,
  onSkipped,
}: {
  student: Student
  skipToday: boolean
  onSkipped: (msg: string) => void
}) {
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: ['skip-status', student.id],
    queryFn: () => api.get<SkipStatus>(`/parent/students/${student.id}/skip-status`),
  })

  const skip = useMutation({
    mutationFn: () => api.post<{ skipped: boolean; notified: string[] }>(`/parent/students/${student.id}/skip-pickup`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['skip-status', student.id] })
      queryClient.invalidateQueries({ queryKey: ['parent-student-detail', student.id] })
      onSkipped(`Skipped today's pickup for ${student.full_name} — notified ${res.notified.length} people.`)
    },
    onError: (err) => onSkipped(err instanceof ApiError ? err.message : 'Could not skip pickup.'),
  })

  if (skipToday) {
    return (
      <Button variant="outline" disabled className="px-6">
        Today's Pickup Skipped
      </Button>
    )
  }

  const eligible = statusQuery.data?.eligible ?? false
  return (
    <Button
      variant={eligible ? 'primary' : 'outline'}
      disabled={!eligible || skip.isPending || statusQuery.isLoading}
      className="px-6"
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
  )
}

// TODO (v2): replace with live GPS tracking. This is a static school-to-house route
// illustration for MVP, not a real map or real location data.
function RouteMap() {
  return (
    <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-low p-4">
      <div className="flex flex-col items-center gap-1">
        <span className="material-symbols-outlined text-primary">school</span>
        <span className="text-label-md">School</span>
      </div>
      <div className="mx-2 h-px flex-1 border-t-2 border-dashed border-outline" />
      <div className="flex flex-col items-center gap-1">
        <span className="material-symbols-outlined text-primary">home</span>
        <span className="text-label-md">Home</span>
      </div>
    </div>
  )
}
