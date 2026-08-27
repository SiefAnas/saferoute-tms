import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatTimeOfDay, formatClock } from '../../lib/format'
import { Button } from '../../components/Button'
import type { Student, SkipStatus, ParentStudentDetail } from '../../types/api'

// Real Parent dashboard (2026-08-27), restyled to adapt (not clone) a Stitch reference
// Anas provided — map hero, status highlight card, vertical trip-progress timeline, and
// the "report absence" / "contact driver" action pair. Per his explicit direction on what
// to fake vs. build for real:
//   - Vehicle info, driver, and the trip timeline are REAL data (GET /parent/students/:id/detail).
//   - The map and the "X mins away" countdown are placeholders, deliberately, until live
//     GPS exists — noted as a V2 item for the WHOLE APP (not just this page), per Anas's
//     own framing, not just this screen. See MapHero/EtaBadge below.
//   - Multiple linked students get a tab switcher (Anas's choice) rather than stacking every
//     student's full section on one long page.
export function ParentHomePage() {
  const [message, setMessage] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const studentsQuery = useQuery({ queryKey: ['parent-students'], queryFn: () => api.get<Student[]>('/parent/students') })
  const students = studentsQuery.data ?? []
  const firstId = studentsQuery.data?.[0]?.id

  useEffect(() => {
    if (!selectedId && firstId) setSelectedId(firstId)
  }, [firstId, selectedId])

  const selected = students.find((s) => s.id === selectedId) ?? null

  if (studentsQuery.isLoading) {
    return <p className="text-body-md text-on-surface-variant">Loading…</p>
  }
  if (students.length === 0) {
    return (
      <p className="text-body-md text-on-surface-variant">
        No students are linked to your account yet — ask your transportation company's admin to link one.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {students.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedId(s.id)}
              className={`shrink-0 rounded-full border px-4 py-2 text-label-md transition-colors ${
                selectedId === s.id
                  ? 'border-primary bg-primary-fixed text-on-primary-fixed-variant'
                  : 'border-outline-variant text-on-surface-variant hover:bg-surface-container'
              }`}
            >
              {s.full_name}
            </button>
          ))}
        </div>
      )}

      {message && (
        <p className="rounded-lg bg-secondary-container px-4 py-2 text-body-md text-on-secondary-container">{message}</p>
      )}

      {selected && <StudentDetailView key={selected.id} student={selected} onMessage={setMessage} />}
    </div>
  )
}

function StudentDetailView({ student, onMessage }: { student: Student; onMessage: (msg: string) => void }) {
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
    ? { label: 'Pickup Skipped Today' }
    : dropoffDone
      ? { label: 'Dropped Off' }
      : pickupDone
        ? { label: 'In Transit' }
        : { label: 'Not Yet Picked Up' }

  if (detailQuery.isLoading) {
    return <p className="text-body-md text-on-surface-variant">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-5">
      <MapHero />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="flex items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-low p-4 shadow-sm">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary-container">
            <span className="material-symbols-outlined text-on-secondary-container">person</span>
          </div>
          <div>
            <h2 className="text-headline-sm text-primary">{student.full_name}</h2>
            <p className="mt-0.5 flex items-center gap-1 text-body-sm text-on-surface-variant">
              <span className="material-symbols-outlined !text-[14px]">school</span>
              {d?.school.name ?? '—'}
            </p>
          </div>
        </div>

        <StatusCard label={status.label} />
      </div>

      {!d?.van || !d?.driver ? (
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

          <TripTimeline
            pickupTrip={pickupTrip}
            dropoffTrip={dropoffTrip}
            pickupScheduled={d.pickup_time}
            dropoffScheduled={d.dropoff_time}
            schoolName={d.school.name}
          />

          <div className="flex flex-col gap-2">
            <SkipPickupButton student={student} skipToday={d.skip_today} onSkipped={onMessage} />
            {d.driver.phone && (
              <a
                href={`tel:${d.driver.phone}`}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-error-container bg-surface-container-low text-body-md font-semibold text-error transition-colors hover:bg-error-container"
              >
                <span className="material-symbols-outlined !text-[20px]">call</span>
                Contact {d.driver.full_name.split(' ')[0]}
              </a>
            )}
            <p className="text-center text-body-sm text-on-surface-variant">For urgent or emergency inquiries only.</p>
          </div>
        </>
      )}
    </div>
  )
}

// TODO (v2): this whole block is a static placeholder — no live GPS exists anywhere in the
// app yet. When real vehicle tracking is built, it should cover the app broadly (this
// dashboard, the company admin fleet view, the driver's own route), not just be bolted onto
// this one screen. Per Anas's explicit instruction: keep this decorative for now.
function MapHero() {
  return (
    <div className="relative h-40 w-full shrink-0 overflow-hidden rounded-2xl bg-surface-container-high sm:h-56">
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 23px, var(--color-outline-variant) 23px, var(--color-outline-variant) 24px), repeating-linear-gradient(90deg, transparent, transparent 23px, var(--color-outline-variant) 23px, var(--color-outline-variant) 24px)',
        }}
      />
      <div className="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center">
        <span className="absolute h-8 w-8 animate-ping rounded-full bg-primary-container opacity-60" />
        <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-surface bg-primary text-on-primary shadow-md">
          <span className="material-symbols-outlined !text-[18px]">directions_bus</span>
        </div>
      </div>
    </div>
  )
}

// TODO (v2): fake countdown, per Anas's explicit instruction to keep it visually complete
// now and wire it to a real ETA once live GPS exists (app-wide, see MapHero above).
// Deliberately NOT derived from any real data — a fixed placeholder value.
function StatusCard({ label }: { label: string }) {
  return (
    <div className="relative flex flex-col justify-center overflow-hidden rounded-2xl border border-primary-container bg-primary-fixed p-4 shadow-sm">
      <span className="material-symbols-outlined absolute -top-4 -right-4 !text-[100px] text-primary opacity-10">radar</span>
      <div className="relative z-10 flex items-center gap-2">
        <span className="material-symbols-outlined text-on-primary-fixed-variant">directions_bus</span>
        <span className="text-label-md tracking-wider text-on-primary-fixed-variant uppercase">{label}</span>
      </div>
      {label === 'In Transit' && (
        <div className="relative z-10 mt-1 flex items-baseline gap-2">
          <span className="text-display-lg font-bold text-primary">5</span>
          <span className="text-headline-sm text-on-primary-fixed-variant">mins away</span>
        </div>
      )}
    </div>
  )
}

function TripTimeline({
  pickupTrip,
  dropoffTrip,
  pickupScheduled,
  dropoffScheduled,
  schoolName,
}: {
  pickupTrip: ParentStudentDetail['trips_today'][number] | undefined
  dropoffTrip: ParentStudentDetail['trips_today'][number] | undefined
  pickupScheduled: string | null
  dropoffScheduled: string | null
  schoolName: string | null
}) {
  const pickupDone = pickupTrip?.status === 'complete'
  const dropoffDone = dropoffTrip?.status === 'complete'

  const steps = [
    {
      label: 'Picked Up at School',
      detail: schoolName ?? '—',
      time: pickupDone && pickupTrip?.completed_at ? formatClock(pickupTrip.completed_at) : formatTimeOfDay(pickupScheduled),
      state: pickupDone ? ('done' as const) : ('upcoming' as const),
    },
    {
      label: 'In Transit',
      detail: null,
      time: null,
      state: pickupDone && !dropoffDone ? ('current' as const) : pickupDone ? ('done' as const) : ('upcoming' as const),
    },
    {
      label: dropoffDone ? 'Dropped Off at Home' : 'Drop-off (est.)',
      detail: null,
      time: dropoffDone && dropoffTrip?.completed_at ? formatClock(dropoffTrip.completed_at) : formatTimeOfDay(dropoffScheduled),
      state: dropoffDone ? ('done' as const) : ('upcoming' as const),
    },
  ]

  return (
    <div>
      <h3 className="mb-3 text-headline-sm text-primary">Trip Progress</h3>
      <div className="relative flex flex-col pl-1">
        {steps.map((step, i) => (
          <div key={step.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              {step.state === 'done' ? (
                <span className="material-symbols-outlined flex h-6 w-6 items-center justify-center rounded-full bg-primary !text-[16px] text-on-primary">
                  check
                </span>
              ) : step.state === 'current' ? (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-fixed-dim shadow-[0_0_0_4px_rgba(245,158,11,0.2)]">
                  <span className="h-2 w-2 rounded-full bg-primary" />
                </span>
              ) : (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-container-highest">
                  <span className="h-2 w-2 rounded-full bg-outline" />
                </span>
              )}
              {i < steps.length - 1 && <span className="h-10 w-px bg-outline-variant" />}
            </div>
            <div className={`pb-3 ${step.state === 'upcoming' ? 'text-on-surface-variant opacity-60' : 'text-on-surface'}`}>
              <p className="text-body-sm text-on-surface-variant">{step.time}</p>
              <p className="text-body-md font-semibold">{step.label}</p>
              {step.detail && <p className="mt-0.5 text-body-sm text-on-surface-variant">{step.detail}</p>}
            </div>
          </div>
        ))}
      </div>
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
      onSkipped(`Reported absence for ${student.full_name} — notified ${res.notified.length} people.`)
    },
    onError: (err) => onSkipped(err instanceof ApiError ? err.message : 'Could not report absence.'),
  })

  const eligible = !skipToday && (statusQuery.data?.eligible ?? false)
  return (
    <Button
      variant="outline"
      disabled={!eligible || skip.isPending || statusQuery.isLoading}
      className="h-11 gap-2 text-body-md"
      onClick={() => skip.mutate()}
    >
      <span className="material-symbols-outlined !text-[20px]">event_busy</span>
      {skip.isPending
        ? 'Reporting…'
        : skipToday || statusQuery.data?.alreadySkipped
          ? 'Absence Reported for Today'
          : eligible
            ? 'Report Absence'
            : (statusQuery.data?.reason ?? 'Report Absence Unavailable')}
    </Button>
  )
}
