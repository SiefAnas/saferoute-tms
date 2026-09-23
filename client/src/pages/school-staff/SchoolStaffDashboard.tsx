import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatClock, isToday } from '../../lib/format'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { ContactLink } from '../../components/ContactLink'
import { Drawer, DetailRows, DrawerSection } from '../../components/Drawer'
import { EmptyState, IconTile, InlineEmpty } from '../../components/EmptyState'
import { NameCell, NoMatches, PageIntro, SearchField, StatCard, StatRow, TableCard, TableRow, matches, stop } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import type { AbsentTodayEntry, School, ScheduleChange, ScheduleChangeType, Student, TransportEntry, Trip } from '../../types/api'

const TRIP_TEMPLATE = '1.5fr 1fr 1.6fr 1fr 130px'
const STUDENT_TEMPLATE = '1.5fr 1.6fr 1.5fr 1.1fr'

// Morning trips are the driver dropping the student at school; afternoon trips are the student
// being handed to the driver for the ride home.
function tripLabel(type: 'pickup' | 'dropoff'): string {
  return type === 'pickup' ? 'Arrived at school' : 'Left with driver'
}

const shiftName = (t: TransportEntry) => (t.shift_period === 'afternoon' ? 'Afternoon' : t.shift_period === 'morning' ? 'Morning' : 'All day')

// Van for a trip: the student's transport entry covering that trip's shift.
function vanFor(student: Student | undefined, trip: Trip) {
  const t = (student?.transport ?? []).find((x) => x.shift_period === 'both' || x.shift_period === trip.shift_period) ?? student?.transport?.[0]
  return t?.van ?? null
}

// School pickup & drop-off (design 5a "Pickup & drop-off"), shared by school_staff and
// school_admin (/school-staff and /school-admin/pickup). The role difference is entirely
// server-side: school_staff's reads/writes are narrowed to their granted students,
// school_admin sees the whole school.
//
//  - Today's trips: every trip a driver logged today, waiting ones first, each with an amber
//    Confirm (POST /trips/:id/confirm) that turns into a Confirmed pill.
//  - Students: who rides, with today's state; the row drawer has the student's full contact
//    and ride details, their trips today (confirm from there too) and "Log change".
//  - Absent today (parent skips + driver no-shows, read-only) and today's schedule changes.
export function SchoolStaffDashboard() {
  const toast = useToast()
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const tripsQuery = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })
  const absentQuery = useQuery({ queryKey: ['absent-today'], queryFn: () => api.get<AbsentTodayEntry[]>('/dashboard/absent-today') })
  const changesQuery = useQuery({ queryKey: ['schedule-changes'], queryFn: () => api.get<ScheduleChange[]>('/schedule-changes') })
  const schoolQuery = useQuery({ queryKey: ['school-me'], queryFn: () => api.get<School>('/schools/me') })

  const [q, setQ] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const [changeStudent, setChangeStudent] = useState<Student | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)

  const students = useMemo(() => studentsQuery.data ?? [], [studentsQuery.data])
  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students])
  const absent = useMemo(() => absentQuery.data ?? [], [absentQuery.data])
  const absentBy = useMemo(() => new Map(absent.map((a) => [a.student_id, a])), [absent])

  // Waiting ones first, then newest first.
  const todaysTrips = useMemo(
    () =>
      (tripsQuery.data ?? [])
        .filter((t) => isToday(t.created_at) || t.status === 'pending')
        .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.created_at.localeCompare(a.created_at)),
    [tripsQuery.data],
  )
  const waiting = todaysTrips.filter((t) => t.status === 'pending')
  const confirmed = todaysTrips.filter((t) => t.status === 'complete')
  const auto = confirmed.filter((t) => t.auto_completed).length

  const queryClient = useQueryClient()
  const confirm = useMutation({
    mutationFn: (trip: Trip) => api.post<Trip>(`/trips/${trip.id}/confirm`),
    onSuccess: (_t, trip) => {
      setConfirmError(null)
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      toast.show(`${studentById.get(trip.student_id)?.full_name ?? 'Student'} confirmed`)
    },
    onError: (err) => setConfirmError(err instanceof ApiError ? err.message : 'Could not confirm.'),
  })

  function todayFor(s: Student): { label: string; tone: BadgeTone } {
    const a = absentBy.get(s.id)
    if (a) return a.type === 'parent_skipped' ? { label: 'Skipped', tone: 'info' } : { label: 'No-show', tone: 'alert' }
    const latest = todaysTrips.filter((t) => t.student_id === s.id)[0]
    if (latest?.status === 'pending') return { label: 'Awaiting you', tone: 'caution' }
    if (latest) return { label: latest.trip_type === 'pickup' ? 'At school' : 'Left with driver', tone: 'success' }
    const transport = s.transport ?? []
    if (transport.length === 0) return { label: 'No ride', tone: 'neutral' }
    if (transport.every((t) => t.shift_period === 'afternoon')) return { label: 'Afternoon only', tone: 'neutral' }
    return { label: 'Not yet', tone: 'neutral' }
  }

  const nameOf = (id: string) => studentById.get(id)?.full_name ?? 'Unknown student'
  const visibleTrips = todaysTrips.filter((t) => matches(q, nameOf(t.student_id), t.driver_name))
  const visibleStudents = students.filter((s) => matches(q, s.full_name, s.parent_name, s.transport?.[0]?.driver?.full_name))
  const detail = students.find((s) => s.id === detailId) ?? null

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Pickup & drop-off">
        <SearchField value={q} onChange={setQ} placeholder="Search students or drivers" />
      </PageTopBar>

      {confirmError && (
        <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
          {confirmError}
        </p>
      )}
      <PageIntro>Confirm students as they arrive. Trips auto-complete 5 minutes after the driver confirms.</PageIntro>

      <StatRow>
        <StatCard label="Waiting on you" value={waiting.length} tone={waiting.length ? 'caution' : 'default'} sub="Tap Confirm as each student arrives" />
        <StatCard
          label="Confirmed today"
          value={confirmed.length}
          tone={confirmed.length ? 'success' : 'default'}
          sub={auto ? `${auto} auto-completed` : confirmed.length ? 'All confirmed by staff' : 'None yet'}
        />
        <StatCard
          label="Absent"
          value={absent.length}
          tone={absent.length ? 'alert' : 'default'}
          sub={`${absent.filter((a) => a.type === 'parent_skipped').length} skipped · ${absent.filter((a) => a.type === 'driver_no_show').length} no-show`}
        />
      </StatRow>

      <TableCard
        title="Today's trips"
        hint="Waiting ones first"
        template={TRIP_TEMPLATE}
        columns={[{ label: 'Student' }, { label: 'Trip' }, { label: 'Driver' }, { label: 'Van' }, { label: '' }]}
      >
        {tripsQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : todaysTrips.length === 0 ? (
          <EmptyState
            icon="directions_bus"
            title="No trips yet today"
            body="When a driver drops a student off or picks one up, it shows here for you to confirm."
            className="border-t border-divider"
          />
        ) : visibleTrips.length === 0 ? (
          <NoMatches q={q} hint="Search looks at student and driver names." onClear={() => setQ('')} />
        ) : (
          visibleTrips.map((t) => {
            const van = vanFor(studentById.get(t.student_id), t)
            return (
              <TableRow key={t.id} template={TRIP_TEMPLATE} onClick={() => setDetailId(t.student_id)}>
                <NameCell name={nameOf(t.student_id)} sub={studentById.get(t.student_id)?.grade ? `Grade ${studentById.get(t.student_id)?.grade}` : undefined} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-ink">{tripLabel(t.trip_type)}</span>
                  <span className="text-[12px] text-muted tabular">{formatClock(t.created_at)}</span>
                </span>
                <span className="flex min-w-0 flex-col" onClick={stop}>
                  <span className="truncate font-medium text-ink">{t.driver_name ?? 'Unknown driver'}</span>
                  {t.driver_phone && (
                    <span className="text-[12px] text-muted">
                      <ContactLink type="phone" value={t.driver_phone} />
                    </span>
                  )}
                </span>
                <span className="truncate text-ink-sub">{van ? (van.number ? `Van ${van.number}` : van.license_plate) : '—'}</span>
                <span className="flex justify-end" onClick={stop}>
                  {t.status === 'pending' ? (
                    <Button size="sm" disabled={confirm.isPending && confirm.variables?.id === t.id} onClick={() => confirm.mutate(t)}>
                      <span className="material-symbols-outlined !text-[16px]">check</span>
                      Confirm
                    </Button>
                  ) : (
                    <StatusBadge tone="success" label={t.auto_completed ? 'Auto-confirmed' : 'Confirmed'} />
                  )}
                </span>
              </TableRow>
            )
          })
        )}
      </TableCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Absent today</CardTitle>
            <span className="text-[12px] text-muted">Not expected today</span>
          </CardHeader>
          {absentQuery.isLoading ? (
            <p className="px-5 py-3 text-[13px] text-muted">Loading…</p>
          ) : absent.length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-3.5">
              <IconTile icon="event_available" tone="success" />
              <span className="text-[13px] text-muted">No skips or no-shows reported today.</span>
            </div>
          ) : (
            absent.map((e, i) => (
              <div key={`${e.student_id}-${i}`} className={`flex h-[42px] items-center justify-between px-5 text-[14px] ${i ? 'border-t border-divider' : ''}`}>
                <span className="font-semibold text-ink">{e.student_name}</span>
                <StatusBadge tone={e.type === 'parent_skipped' ? 'info' : 'alert'} label={e.type === 'parent_skipped' ? 'Parent skipped' : 'No-show'} />
              </div>
            ))
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>Schedule changes today</CardTitle>
            <span className="text-[12px] text-muted">Log one from a student&apos;s details</span>
          </CardHeader>
          {changesQuery.isLoading ? (
            <p className="px-5 py-3 text-[13px] text-muted">Loading…</p>
          ) : (changesQuery.data ?? []).length === 0 ? (
            <div className="flex items-center gap-3 px-5 py-3.5">
              <IconTile icon="event_note" tone="neutral" />
              <span className="text-[13px] text-muted">Nobody left early or stayed late today.</span>
            </div>
          ) : (
            (changesQuery.data ?? []).map((c, i) => (
              <div key={c.id} className={`flex min-h-[42px] items-center justify-between gap-3 px-5 py-2 text-[14px] ${i ? 'border-t border-divider' : ''}`}>
                <span className="min-w-0 text-ink">
                  <span className="font-semibold">{nameOf(c.student_id)}</span>
                  <span className="text-muted">
                    {' · '}
                    {c.change_type === 'left_early' ? 'Left early' : 'Staying later'}
                    {c.note ? ` (${c.note})` : ''}
                  </span>
                </span>
                <span className="text-[12px] text-muted tabular">{formatClock(c.created_at)}</span>
              </div>
            ))
          )}
        </Card>
      </div>

      <TableCard
        title="Students"
        hint="Click a student for contacts, rides and schedule changes"
        template={STUDENT_TEMPLATE}
        columns={[{ label: 'Student' }, { label: 'Company · driver' }, { label: 'Guardian' }, { label: 'Today' }]}
      >
        {studentsQuery.isLoading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : students.length === 0 ? (
          <EmptyState
            icon="groups"
            title="No students to show"
            body="Staff see only the students a school admin grants them. Ask yours to add some."
            className="border-t border-divider"
          />
        ) : visibleStudents.length === 0 ? (
          <NoMatches q={q} hint="Search looks at student, guardian and driver names." onClear={() => setQ('')} />
        ) : (
          visibleStudents.map((s) => {
            const t = todayFor(s)
            const first = s.transport?.[0]
            return (
              <TableRow key={s.id} template={STUDENT_TEMPLATE} selected={detailId === s.id} onClick={() => setDetailId(s.id)}>
                <NameCell name={s.full_name} sub={s.grade ? `Grade ${s.grade}` : undefined} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-ink">{first?.company_name ?? 'No company yet'}</span>
                  <span className="truncate text-[12px] text-muted">
                    {[...new Set((s.transport ?? []).map((x) => x.driver?.full_name).filter(Boolean))].join(', ')}
                  </span>
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium text-ink">{s.parent_name ?? '—'}</span>
                  <span className="truncate text-[12px] text-muted tabular">{s.parent_phone ?? ''}</span>
                </span>
                <span>
                  <StatusBadge tone={t.tone} label={t.label} />
                </span>
              </TableRow>
            )
          })
        )}
      </TableCard>

      {detail && (
        <StudentDrawer
          student={detail}
          school={schoolQuery.data}
          trips={todaysTrips.filter((t) => t.student_id === detail.id)}
          today={todayFor(detail)}
          confirming={confirm.isPending ? confirm.variables?.id : undefined}
          onConfirm={(t) => confirm.mutate(t)}
          onLogChange={() => setChangeStudent(detail)}
          onClose={() => setDetailId(null)}
        />
      )}

      {changeStudent && (
        <LogScheduleChangeModal
          student={changeStudent}
          onClose={() => setChangeStudent(null)}
          onLogged={() => toast.show(`Change logged for ${changeStudent.full_name}`)}
        />
      )}
      {toast.node}
    </div>
  )
}

function StudentDrawer({
  student,
  school,
  trips,
  today,
  confirming,
  onConfirm,
  onLogChange,
  onClose,
}: {
  student: Student
  school: School | undefined
  trips: Trip[]
  today: { label: string; tone: BadgeTone }
  confirming: string | undefined
  onConfirm: (t: Trip) => void
  onLogChange: () => void
  onClose: () => void
}) {
  // Extra contacts and the home address come from GET /students/:id, fetched when the drawer opens.
  const detailQuery = useQuery({ queryKey: ['student-detail', student.id], queryFn: () => api.get<Student>(`/students/${student.id}`) })
  const d = detailQuery.data
  const home = d ? [d.street_address, d.city, d.state, d.zip_code].filter(Boolean).join(', ') : ''
  const transport = student.transport ?? []

  return (
    <Drawer
      eyebrow="DETAILS"
      title={student.full_name}
      subtitle={[student.grade ? `Grade ${student.grade}` : null, school?.name].filter(Boolean).join(' · ')}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onLogChange}>
            <span className="material-symbols-outlined !text-[18px]">event_note</span>
            Log change
          </Button>
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <DetailRows
        rows={[
          { k: 'Today', v: <StatusBadge tone={today.tone} label={today.label} /> },
          { k: 'Guardian', v: student.parent_name ?? '—' },
          { k: 'Phone', v: <ContactLink type="phone" value={student.parent_phone} /> },
          { k: 'Home', v: detailQuery.isLoading ? '…' : home || '—' },
        ]}
      />

      <DrawerSection title="Trips today">
        {trips.length === 0 ? (
          <InlineEmpty icon="directions_bus" text="No trips logged for this student today." />
        ) : (
          trips.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-3 border-b border-divider py-2 text-[14px]">
              <span className="flex min-w-0 flex-col">
                <span className="text-ink">
                  {tripLabel(t.trip_type)} · <span className="tabular">{formatClock(t.created_at)}</span>
                </span>
                <span className="text-[12px] text-muted">{t.driver_name ?? 'Unknown driver'}</span>
              </span>
              {t.status === 'pending' ? (
                <Button size="sm" disabled={confirming === t.id} onClick={() => onConfirm(t)}>
                  Confirm
                </Button>
              ) : (
                <StatusBadge tone="success" label={t.auto_completed ? 'Auto-confirmed' : 'Confirmed'} />
              )}
            </div>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Rides">
        {transport.length === 0 ? (
          <InlineEmpty icon="no_transfer" text="No driver or van assigned right now." />
        ) : (
          transport.map((t, i) => (
            <div key={i} className="flex flex-col gap-0.5 border-b border-divider py-2 text-[14px]">
              <span className="font-semibold text-ink">
                {transport.length > 1 ? `${shiftName(t)} · ` : ''}
                {t.company_name ?? 'Transport company'}
              </span>
              <span className="text-ink-sub">
                {t.driver ? t.driver.full_name : 'No driver'}
                {t.driver?.phone ? (
                  <>
                    {' · '}
                    <ContactLink type="phone" value={t.driver.phone} />
                  </>
                ) : null}
              </span>
              <span className="text-[13px] text-muted">
                {t.van ? `${t.van.number ? `Van ${t.van.number} · ` : ''}${[t.van.color, t.van.brand, t.van.model].filter(Boolean).join(' ')} (${t.van.year}) · ${t.van.license_plate}` : 'No van on this ride'}
              </span>
            </div>
          ))
        )}
      </DrawerSection>

      <DrawerSection title="Other contacts">
        {detailQuery.isLoading ? (
          <p className="text-[13px] text-muted">Loading…</p>
        ) : (d?.contacts ?? []).length === 0 ? (
          <p className="text-[13px] text-muted">None on file.</p>
        ) : (
          (d?.contacts ?? []).map((c) => (
            <div key={c.id} className="border-b border-divider py-2 text-[14px] text-ink">
              <span className="font-medium">{c.name}</span>
              <span className="text-muted">{c.relationship ? ` · ${c.relationship}` : ''}</span>
              {c.phone ? (
                <>
                  {' · '}
                  <ContactLink type="phone" value={c.phone} />
                </>
              ) : null}
            </div>
          ))
        )}
      </DrawerSection>

      {school && (
        <DrawerSection title="School">
          <div className="flex flex-col gap-0.5 text-[14px] text-ink-sub">
            <span className="font-medium text-ink">{school.name}</span>
            <ContactLink type="phone" value={school.phone} />
            {school.address && <span>{school.address}</span>}
            {school.hours && <span>Hours: {school.hours}</span>}
          </div>
        </DrawerSection>
      )}
    </Drawer>
  )
}

function LogScheduleChangeModal({ student, onClose, onLogged }: { student: Student; onClose: () => void; onLogged: () => void }) {
  const queryClient = useQueryClient()
  const [changeType, setChangeType] = useState<ScheduleChangeType>('left_early')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const log = useMutation({
    mutationFn: () =>
      api.post<ScheduleChange & { notified: string[]; skipped_assignment_id: string | null }>(`/schedule-changes/students/${student.id}`, {
        change_type: changeType,
        note: note || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedule-changes'] })
      onLogged()
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
    <Modal title={`Log a schedule change: ${student.full_name}`} onClose={onClose}>
      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <div className="flex flex-col gap-2 text-[14px] text-ink">
          {(
            [
              ['left_early', 'Left early', 'a parent already picked them up'],
              ['staying_later', 'Staying later', 'not leaving on the usual schedule'],
            ] as const
          ).map(([value, title, sub]) => (
            <label
              key={value}
              className={`flex cursor-pointer items-center gap-2.5 rounded-m border px-3 py-2.5 ${changeType === value ? 'border-amber bg-row-selected' : 'border-line'}`}
            >
              <input type="radio" checked={changeType === value} onChange={() => setChangeType(value)} className="accent-amber" />
              <span>
                <strong className="font-semibold">{title}</strong>
                <span className="text-muted"> · {sub}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="text-[12px] text-muted">Either way, today&apos;s scheduled company pickup for this student is cancelled.</p>
        <textarea
          placeholder="Note (optional)"
          aria-label="Note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full rounded-row border border-outline bg-surface px-3 py-2 text-[14px] text-ink outline-none placeholder:text-faint focus:border-amber focus:ring-2 focus:ring-amber/20"
        />
        <p className="text-[12px] text-muted">Notifies the company admin, school admin, this student&apos;s driver, and their parent(s).</p>
        {error && (
          <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={log.isPending}>
            {log.isPending ? 'Logging…' : 'Log change'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
