import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { firstName, formatClock, formatTimeOfDay } from '../../lib/format'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { Avatar } from '../../components/Records'
import { CallButton, ConfirmCard, ThumbBar } from '../../components/mobile'
import type { BadgeTone } from '../../components/StatusBadge'
import { useComingSoon } from '../../components/ComingSoon'
import { LG_QUERY, MD_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import { FilterChip, StatCard, StatRow } from '../../components/Records'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { PageTopBar } from '../../layouts/TopBar'
import { DifferentAddressNote, extraAddressSchedule } from '../../components/Route'
import { AddressText } from '../../components/AddressText'
import { formatWeekdayDate } from '../../lib/format'
import type { ParentStudentDetail, ParentTransportEntry, SkipStatus, Student } from '../../types/api'

const BANNER: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success-fg',
  caution: 'bg-caution-bg text-caution-fg',
  alert: 'bg-alert-bg text-alert-fg',
  info: 'bg-info-bg text-info-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
  next: 'bg-next-bg text-next-fg',
}

// Parent app, Students tab (design 5b). All real data: GET /parent/students,
// /parent/students/:id/detail (van, driver, times, today's trips) and /skip-status.
//
// V2 (V2_ROADMAP.md): the design's "Van 04 is 3 stops away" banner and live map need live stop
// progress / GPS. The banner shows what IS known (skipped, arrived, dropped off, next pickup
// time) and a "Live location and ETA" row opens Coming Soon.
//
// Wide desktops (lg) show the children list and the selected child side by side.
export function ParentHomePage() {
  const sideBySide = useMediaQuery(LG_QUERY)
  const wide = useMediaQuery(MD_QUERY)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const studentsQuery = useQuery({ queryKey: ['parent-students'], queryFn: () => api.get<Student[]>('/parent/students') })
  const students = studentsQuery.data ?? []
  const firstId = studentsQuery.data?.[0]?.id

  useEffect(() => {
    if (!selectedId && firstId) setSelectedId(firstId)
  }, [firstId, selectedId])

  const selected = students.find((s) => s.id === selectedId) ?? null

  if (studentsQuery.isLoading) return <p className="px-5 pt-6 text-[14px] text-muted">Loading…</p>
  if (students.length === 0) {
    return (
      <EmptyState
        className="mt-4"
        icon="family_restroom"
        title="No students linked yet"
        body="Ask your transportation company to link your child to your account. They'll show up here."
      />
    )
  }

  // Desktop (md and up): an admin-style page. Wide screens put the children list beside the
  // selected child; tablets show the children as chips above it.
  if (wide) {
    return (
      <div className="flex flex-col gap-5">
        <PageTopBar title={selected ? selected.full_name : 'Your children'} subtitle={formatWeekdayDate()} />
        {!sideBySide && students.length > 1 && (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Your children">
            {students.map((s) => (
              <FilterChip key={s.id} active={selectedId === s.id} onClick={() => setSelectedId(s.id)}>
                {s.full_name}
              </FilterChip>
            ))}
          </div>
        )}
        <div className={sideBySide ? 'grid grid-cols-[280px_minmax(0,1fr)] items-start gap-5' : ''}>
          {sideBySide && (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>Your children</CardTitle>
              </CardHeader>
              {students.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-current={selectedId === s.id ? 'true' : undefined}
                  onClick={() => setSelectedId(s.id)}
                  className={`flex w-full cursor-pointer items-center gap-3 border-t border-divider px-5 py-3 text-left first-of-type:border-t-0 hover:bg-row-hover ${
                    selectedId === s.id ? 'bg-row-selected' : ''
                  }`}
                >
                  <Avatar name={s.full_name} size={32} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[14px] font-semibold text-ink">{s.full_name}</span>
                    {s.grade && <span className="text-[12px] text-muted">Grade {s.grade}</span>}
                  </span>
                </button>
              ))}
            </Card>
          )}
          <div className="min-w-0">{selected && <ChildView key={selected.id} student={selected} />}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 pt-4">
      {students.length > 1 && (
        <div className="flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Your children">
          {students.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={selectedId === s.id}
              onClick={() => setSelectedId(s.id)}
              className={`h-9 shrink-0 cursor-pointer rounded-full px-4 text-[14px] font-medium transition-colors ${
                selectedId === s.id ? 'bg-action text-on-action' : 'border border-line bg-surface text-ink'
              }`}
            >
              {firstName(s.full_name)}
            </button>
          ))}
        </div>
      )}
      {selected && <ChildView key={selected.id} student={selected} />}
    </div>
  )
}

function ChildView({ student }: { student: Student }) {
  const openComingSoon = useComingSoon()
  const wide = useMediaQuery(MD_QUERY)
  const detailQuery = useQuery({
    queryKey: ['parent-student-detail', student.id],
    queryFn: () => api.get<ParentStudentDetail>(`/parent/students/${student.id}/detail`),
  })
  const d = detailQuery.data

  if (detailQuery.isLoading || !d) return <p className="px-5 text-[14px] text-muted">Loading…</p>

  const transport = d.transport
  // Today's times come only from rides that run on today's weekday (runs_today); the driver
  // cards below still show every ride.
  const today = transport.filter((t) => t.runs_today !== false)
  const noRideToday = transport.length > 0 && today.length === 0
  const morning = today.find((t) => t.shift_period !== 'afternoon')
  const afternoon = today.find((t) => t.shift_period !== 'morning')
  const pickupTrip = d.trips_today.find((t) => t.trip_type === 'pickup')
  const dropoffTrip = d.trips_today.find((t) => t.trip_type === 'dropoff')

  // What we honestly know about today, most recent first.
  let banner: { tone: BadgeTone; icon: string; text: string } | null
  if (d.skip_today) banner = { tone: 'info', icon: 'event_busy', text: 'Morning pickup skipped today' }
  else if (dropoffTrip) banner = { tone: 'success', icon: 'home', text: `Dropped off at ${formatClock(dropoffTrip.created_at)}` }
  else if (pickupTrip?.status === 'complete') banner = { tone: 'success', icon: 'school', text: `Arrived at school ${formatClock(pickupTrip.completed_at ?? pickupTrip.created_at)}` }
  else if (pickupTrip) banner = { tone: 'caution', icon: 'directions_bus', text: `Dropped at school ${formatClock(pickupTrip.created_at)}, waiting for the school to confirm` }
  else if (transport.length === 0) banner = { tone: 'neutral', icon: 'no_transfer', text: 'No ride set up yet' }
  else if (noRideToday) banner = { tone: 'neutral', icon: 'event_busy', text: 'No ride today' }
  else if (!morning) banner = { tone: 'neutral', icon: 'wb_sunny', text: 'Afternoon ride only' }
  else banner = morning.pickup_time ? { tone: 'neutral', icon: 'schedule', text: `Pickup at ${formatTimeOfDay(morning.pickup_time)}` } : null

  // Today's pickup / drop-off place from the server's route (an extra address replaces home on
  // its days, e.g. "Grandparents"); highlighted so it doesn't read as the usual routine.
  const pickupPlace = morning?.route?.morning?.from
  const dropoffPlace = afternoon?.route?.afternoon?.to
  const different = [pickupPlace, dropoffPlace].find((p) => p?.kind === 'extra')
  const rows = [
    {
      label: 'Morning pickup',
      value: d.skip_today ? 'Skipped today' : morning ? `${formatTimeOfDay(morning.pickup_time)} · ${pickupPlace?.label ?? 'Home'}` : noRideToday ? 'No ride today' : 'No ride',
      place: d.skip_today ? undefined : pickupPlace,
    },
    {
      label: 'Arrives at school',
      value: pickupTrip?.status === 'complete' ? `${formatClock(pickupTrip.completed_at ?? pickupTrip.created_at)} · ${d.school.name ?? 'School'}` : (d.school.name ?? '—'),
    },
    {
      label: 'Afternoon drop-off',
      value: afternoon ? `${formatTimeOfDay(afternoon.dropoff_time)} · ${dropoffPlace?.label ?? 'Home'}` : noRideToday ? 'No ride today' : 'No ride',
      place: dropoffPlace,
    },
  ]

  const otherAddresses = d.extra_addresses.length > 0 && (
    <Card className="overflow-hidden">
      <CardHeader>
        <CardTitle>Other addresses</CardTitle>
        <span className="text-[12px] text-muted">Set by {d.company.name ?? 'your transportation company'}</span>
      </CardHeader>
      {d.extra_addresses.map((x) => (
        <div key={x.id} className="flex flex-col gap-0.5 border-t border-divider px-5 py-3 first-of-type:border-t-0">
          <span className="text-[14px] font-semibold text-ink">{x.label}</span>
          {x.address && <AddressText address={x.address} />}
          <span className="text-[12px] text-muted">{extraAddressSchedule(x)}</span>
        </div>
      ))}
    </Card>
  )

  // One driver card per distinct driver (split students can have two).
  const drivers = transport.filter((t, i) => t.driver && transport.findIndex((x) => x.driver?.full_name === t.driver?.full_name) === i)

  if (wide) {
    return (
      <div className="flex flex-col gap-5">
        <Card className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={student.full_name} size={44} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-[18px] font-semibold text-ink">{student.full_name}</span>
              <span className="truncate text-[13px] text-muted">{[student.grade ? `Grade ${student.grade}` : null, d.school.name].filter(Boolean).join(' · ')}</span>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            {banner && (
              <span className={`flex items-center gap-2 rounded-row px-3 py-2 text-[14px] font-medium ${BANNER[banner.tone]}`}>
                <span className="material-symbols-outlined !text-[18px]">{banner.icon}</span>
                {banner.text}
              </span>
            )}
            {different && <DifferentAddressNote place={different} />}
          </div>
        </Card>

        <StatRow template="1fr 1fr 1fr">
          {rows.map((r) => (
            <StatCard
              key={r.label}
              label={r.label}
              value={<span className="text-[20px]">{r.value}</span>}
              sub={r.place?.address ?? undefined}
              subTone={r.place?.kind === 'extra' ? 'caution' : 'default'}
            />
          ))}
        </StatRow>

        <div className="grid items-start gap-5 lg:grid-cols-2">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle>{drivers.length > 1 ? 'Drivers and vans' : 'Driver and van'}</CardTitle>
              {transport.length > 0 && (
                <button type="button" onClick={() => openComingSoon('Live van tracking')} className="cursor-pointer text-[12px] font-semibold text-info-fg">
                  Live location · Coming soon
                </button>
              )}
            </CardHeader>
            {drivers.length === 0 ? (
              <p className="px-5 py-4 text-[14px] text-muted">No driver assigned yet. {d.company.name ? `${d.company.name} sets this up.` : ''}</p>
            ) : (
              drivers.map((t, i) => {
                const v = t.van
                return (
                  <div key={i} className="flex items-center gap-3 border-t border-divider px-5 py-3.5 first-of-type:border-t-0">
                    <Avatar name={t.driver!.full_name} size={44} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-semibold text-ink">
                        {t.driver!.full_name}
                        {drivers.length > 1 && <span className="text-[12px] font-normal text-muted"> · {t.shift_period === 'afternoon' ? 'Afternoon' : 'Morning'}</span>}
                      </span>
                      <span className="truncate text-[13px] text-muted">
                        {v ? [v.number ? `Van ${v.number}` : null, [v.color, v.brand, v.model].filter(Boolean).join(' '), v.license_plate].filter(Boolean).join(' · ') : 'No van on file'}
                      </span>
                    </div>
                    {t.driver!.phone && (
                      <a href={`tel:${t.driver!.phone.replace(/[^0-9+]/g, '')}`} className="flex items-center gap-1.5 rounded-btn border border-outline px-3 py-2 text-[13px] font-medium text-ink hover:bg-surface-2">
                        <span className="material-symbols-outlined !text-[18px]">call</span>
                        {t.driver!.phone}
                      </a>
                    )}
                  </div>
                )
              })
            )}
          </Card>
          <SkipBar student={student} detail={d} inline />
          {otherAddresses}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mx-4 flex flex-col gap-3 rounded-m border border-line bg-surface p-4 shadow-card">
        <div className="flex flex-col">
          <span className="text-[18px] font-semibold text-ink">{student.full_name}</span>
          <span className="text-[13px] text-muted">{[student.grade ? `Grade ${student.grade}` : null, d.school.name].filter(Boolean).join(' · ')}</span>
        </div>
        {banner && (
          <div className={`flex items-center gap-2 rounded-row px-3 py-2.5 text-[13px] font-medium ${BANNER[banner.tone]}`}>
            <span className="material-symbols-outlined !text-[18px]">{banner.icon}</span>
            {banner.text}
          </div>
        )}
        {different && <DifferentAddressNote place={different} />}
        {/* V2: "Van is X stops away" + live map need live stop progress / GPS. */}
        {transport.length > 0 && (
          <button
            type="button"
            onClick={() => openComingSoon('Live van tracking')}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-row border border-line px-3 py-2.5 text-left text-[13px] text-ink hover:bg-surface-2"
          >
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined !text-[18px] text-muted">near_me</span>
              Live location and ETA
            </span>
            <span className="rounded-pill bg-info-bg px-2 py-0.5 text-[11px] font-semibold text-info-fg">Coming soon</span>
          </button>
        )}
      </div>

      <div className="mx-4 rounded-m border border-line bg-surface shadow-card">
        <div className="px-4 pt-3 pb-1 text-[13px] font-semibold text-ink">Today</div>
        {rows.map((r, i) => (
          <div key={r.label} className={`flex items-center justify-between gap-3 px-4 py-2.5 text-[14px] ${i ? 'border-t border-divider' : ''}`}>
            <span className="text-muted">{r.label}</span>
            <span className={`text-right font-medium tabular ${r.place?.kind === 'extra' ? 'text-caution-fg' : 'text-ink'}`}>{r.value}</span>
          </div>
        ))}
      </div>

      {otherAddresses && <div className="mx-4">{otherAddresses}</div>}

      {drivers.length === 0 ? (
        <div className="mx-4 rounded-m border border-line bg-surface px-4 py-3 text-[13px] text-muted">
          No driver assigned yet. {d.company.name ? `${d.company.name} sets this up.` : ''}
        </div>
      ) : (
        drivers.map((t, i) => <DriverCard key={i} entry={t} labelShift={drivers.length > 1} />)
      )}

      <SkipBar student={student} detail={d} />
    </>
  )
}

function DriverCard({ entry, labelShift }: { entry: ParentTransportEntry; labelShift: boolean }) {
  const v = entry.van
  return (
    <div className="mx-4 flex items-center gap-3 rounded-m border border-line bg-surface px-4 py-3 shadow-card">
      <Avatar name={entry.driver!.full_name} size={44} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[15px] font-semibold text-ink">
          {entry.driver!.full_name}
          {labelShift && <span className="text-[12px] font-normal text-muted"> · {entry.shift_period === 'afternoon' ? 'Afternoon' : 'Morning'}</span>}
        </span>
        <span className="truncate text-[12px] text-muted">
          {v ? [v.number ? `Van ${v.number}` : null, [v.color, v.brand, v.model].filter(Boolean).join(' '), v.license_plate].filter(Boolean).join(' · ') : 'No van on file'}
        </span>
      </div>
      {entry.driver!.phone && <CallButton phone={entry.driver!.phone} primary label={`Call ${entry.driver!.full_name}`} />}
    </div>
  )
}

// Thumb bar: "Skip today's pickup" (outline, 52px) with a confirm card. Eligibility is the
// server's call (GET /skip-status). Split students (separate morning and afternoon rides) choose
// morning only or the whole day.
// `inline` (desktop): the same content in a card on the page instead of the phone's thumb bar.
function SkipBar({ student, detail, inline = false }: { student: Student; detail: ParentStudentDetail; inline?: boolean }) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<'single' | 'morning' | 'whole_day' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const statusQuery = useQuery({
    queryKey: ['skip-status', student.id],
    queryFn: () => api.get<SkipStatus>(`/parent/students/${student.id}/skip-status`),
  })
  const data: SkipStatus | undefined = statusQuery.data

  const skip = useMutation({
    mutationFn: (shiftChoice?: 'morning' | 'whole_day') =>
      api.post<{ skipped: boolean; notified: string[] }>(`/parent/students/${student.id}/skip-pickup`, shiftChoice ? { shift_choice: shiftChoice } : undefined),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['skip-status', student.id] })
      queryClient.invalidateQueries({ queryKey: ['parent-student-detail', student.id] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not skip the pickup.'),
  })

  const name = firstName(student.full_name)
  const hasAfternoon = detail.transport.some((t) => t.shift_period !== 'morning')
  const hasMorning = detail.transport.some((t) => t.shift_period !== 'afternoon')
  const caption = 'Available until the van leaves for your stop'

  let content
  if (statusQuery.isLoading) {
    content = <span className="py-2 text-center text-[13px] text-muted">Loading…</span>
  } else if (!hasMorning) {
    content = <span className="py-2 text-center text-[13px] text-muted">{name} has no morning ride, so there&apos;s no pickup to skip.</span>
  } else if (data?.splitShift) {
    const { morningOnly, wholeDay } = data
    if (morningOnly.alreadySkipped || wholeDay.alreadySkipped) {
      content = (
        <span className="py-2 text-center text-[13px] text-muted">
          {wholeDay.alreadySkipped ? `Skipped for the whole day.` : 'Morning skipped. Afternoon drop-off is unchanged.'}
        </span>
      )
    } else {
      content = (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" variant="outline" disabled={!morningOnly.eligible || skip.isPending} onClick={() => setPending('morning')}>
              Skip morning
            </Button>
            <Button size="lg" variant="outline" disabled={!wholeDay.eligible || skip.isPending} onClick={() => setPending('whole_day')}>
              Skip whole day
            </Button>
          </div>
          <span className="text-center text-[12px] text-muted">{caption}</span>
        </>
      )
    }
  } else {
    const status = data && data.splitShift === false ? data : null
    if (detail.skip_today || status?.alreadySkipped) {
      content = (
        <span className="py-2 text-center text-[13px] text-muted">
          Skipped.{hasAfternoon ? ' Afternoon drop-off is unchanged.' : ''}
        </span>
      )
    } else {
      content = (
        <>
          <Button size="lg" variant="outline" disabled={!status?.eligible || skip.isPending} onClick={() => setPending('single')}>
            <span className="material-symbols-outlined !text-[20px]">event_busy</span>
            {skip.isPending ? 'Skipping…' : "Skip today's pickup"}
          </Button>
          <span className="text-center text-[12px] text-muted">{status?.eligible ? caption : (status?.reason ?? caption)}</span>
        </>
      )
    }
  }

  const body = (
    <>
      {error && (
        <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
          {error}
        </p>
      )}
      {content}
    </>
  )

  return (
    <>
      {inline ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Today&apos;s pickup</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-2.5 px-5 py-4">{body}</div>
        </Card>
      ) : (
        <ThumbBar>{body}</ThumbBar>
      )}
      {pending && (
        <ConfirmCard
          title={pending === 'whole_day' ? `Skip ${name}'s rides today?` : `Skip ${name}'s pickup today?`}
          body={
            pending === 'whole_day'
              ? 'Both the morning pickup and the afternoon drop-off are cancelled for today. The driver and school are told.'
              : `The driver won't stop for ${name} this morning. The driver and school are told.${hasAfternoon ? ' Afternoon drop-off stays as usual.' : ''}`
          }
          cancelLabel="Keep pickup"
          confirmLabel={pending === 'whole_day' ? 'Skip whole day' : 'Skip pickup'}
          busy={skip.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            skip.mutate(pending === 'single' ? undefined : pending)
            setPending(null)
          }}
        />
      )}
    </>
  )
}
