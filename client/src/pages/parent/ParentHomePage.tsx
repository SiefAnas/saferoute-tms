import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatTimeOfDay, formatClock } from '../../lib/format'
import { Button } from '../../components/Button'
import { ContactLink } from '../../components/ContactLink'
import type { Student, SkipStatus, ParentStudentDetail, ParentProfile } from '../../types/api'

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
        No students are linked to your account yet. Ask your transportation company's admin to link one.
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

// TODO (v2, § pickup-confirmation task): this student view has no live map/GPS or live
// pickup status — both explicitly deferred. The MapHero/StatusCard placeholders that used to
// sit here (fake "5 mins away" countdown, a static decorative map) were removed as part of
// the mobile compact-view redesign rather than kept as visual filler; when live GPS/pickup
// status is actually built, it should cover the app broadly (this dashboard, the company
// admin fleet view, the driver's own route), not be bolted onto just this one screen.
function StudentDetailView({ student, onMessage }: { student: Student; onMessage: (msg: string) => void }) {
  const [showMore, setShowMore] = useState(false)
  const detailQuery = useQuery({
    queryKey: ['parent-student-detail', student.id],
    queryFn: () => api.get<ParentStudentDetail>(`/parent/students/${student.id}/detail`),
  })
  const profileQuery = useQuery({
    queryKey: ['parent-me'],
    queryFn: () => api.get<ParentProfile>('/parent/me'),
    enabled: showMore,
  })
  const d = detailQuery.data

  const pickupTrip = d?.trips_today.find((t) => t.trip_type === 'pickup')
  const dropoffTrip = d?.trips_today.find((t) => t.trip_type === 'dropoff')
  const pickupDone = pickupTrip?.status === 'complete'
  const dropoffDone = dropoffTrip?.status === 'complete'

  const statusLabel = d?.skip_today
    ? 'Pickup Skipped Today'
    : dropoffDone
      ? 'Dropped Off'
      : pickupDone
        ? 'In Transit'
        : 'Not Yet Picked Up'

  if (detailQuery.isLoading) {
    return <p className="text-body-md text-on-surface-variant">Loading…</p>
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Compact default view (mobile): kid name, grade, company name, van type — everything
          else lives behind "More info" so the default screen stays short on a phone. */}
      <div className="flex items-center gap-3 rounded-2xl border border-outline-variant bg-surface-container-low p-4 shadow-sm">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-secondary-container">
          <span className="material-symbols-outlined text-on-secondary-container">person</span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-headline-sm text-primary">{student.full_name}</h2>
          <p className="text-body-sm text-on-surface-variant">
            {student.grade ? `Grade ${student.grade}` : 'Grade -'} · {d?.company.name ?? 'No company assigned'}
            {d?.van ? ` · ${d.van.brand} ${d.van.model}` : ''}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-primary-container bg-primary-fixed px-3 py-1 text-label-md text-on-primary-fixed-variant">
          {statusLabel}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <SkipPickupButton student={student} skipToday={d?.skip_today ?? false} onSkipped={onMessage} />
        {d?.driver?.phone && (
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

      <button
        type="button"
        onClick={() => setShowMore((v) => !v)}
        className="flex items-center justify-center gap-1 rounded-lg border border-outline-variant py-2 text-label-md text-primary hover:bg-surface-container"
      >
        {showMore ? 'Less info' : 'More info'}
        <span className="material-symbols-outlined !text-[18px]">{showMore ? 'expand_less' : 'expand_more'}</span>
      </button>

      {showMore && (
        <div className="flex flex-col gap-5">
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
                  ['Color', d.van.color ?? '-'],
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
            </>
          )}

          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4">
            <h3 className="mb-2 text-label-md text-secondary uppercase">Company</h3>
            <p className="text-body-md text-on-surface">{d?.company.name ?? '-'}</p>
            <p className="text-body-md text-on-surface-variant">
              <ContactLink type="phone" value={d?.company.phone} />
            </p>
          </div>

          {d?.driver && (
            <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4">
              <h3 className="mb-2 text-label-md text-secondary uppercase">Driver</h3>
              <p className="text-body-md text-on-surface">{d.driver.full_name}</p>
              <p className="text-body-md text-on-surface-variant">
                <ContactLink type="phone" value={d.driver.phone} />
              </p>
            </div>
          )}

          <div className="rounded-lg border border-outline-variant bg-surface-container-low p-4">
            <h3 className="mb-2 text-label-md text-secondary uppercase">Your Info</h3>
            {profileQuery.isLoading ? (
              <p className="text-body-md text-on-surface-variant">Loading…</p>
            ) : (
              <div className="flex flex-col gap-1 text-body-md text-on-surface-variant">
                <p className="text-on-surface">{profileQuery.data?.full_name}</p>
                <p>
                  <ContactLink type="email" value={profileQuery.data?.email} />
                </p>
                <p>
                  <ContactLink type="phone" value={profileQuery.data?.phone} />
                </p>
                <p>{profileQuery.data?.address ?? '-'}</p>
              </div>
            )}
          </div>
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
      detail: schoolName ?? '-',
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
      onSkipped(`Reported absence for ${student.full_name}. Notified ${res.notified.length} people.`)
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
