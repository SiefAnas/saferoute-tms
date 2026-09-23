import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/Button'
import { Field, Input, Select, FIELD_CLASS } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { Drawer, DetailRows, DrawerSection } from '../../components/Drawer'
import { EmptyState, InlineEmpty } from '../../components/EmptyState'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { NameCell, NoMatches, PageIntro, SearchField, StatCard, StatRow, TableCard, TableRow, matches, stop } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { PageTopBar } from '../../layouts/TopBar'
import { formatCalendarMonthDay, formatTimeOfDay } from '../../lib/format'
import { calendarDateOf, localISODate } from '../../lib/localDate'
import { driverCurrentVanId, studentsTakenByOtherDrivers, vansTakenByOtherDrivers } from '../../lib/assignmentRules'
import type { Assignment, AssignmentShiftPeriod, PublicUser, ScheduleOverride, Student, Van } from '../../types/api'

const SHIFT_LABELS: Record<AssignmentShiftPeriod, string> = { morning: 'Morning', afternoon: 'Afternoon', both: 'Both' }
const TEMPLATE = '1.5fr 1.4fr 1fr 1.3fr 1.2fr 1.1fr'

function weekBounds() {
  const d = new Date()
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  const mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff)
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6)
  return { from: localISODate(mon), to: localISODate(sun) }
}

// Company Admin — Assignments (design 5a records template): which driver + van carries which
// student, on which shift, and for how long. GET /assignments returns ids only; names are joined
// client-side. Unassigned students show as rows too, so they're one click from getting a driver.
// Per-assignment details (usual times, one-off schedule overrides, end/delete) live in the drawer.
export function AssignmentsPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })

  const studentsById = useMemo(() => new Map((studentsQuery.data ?? []).map((s) => [s.id, s])), [studentsQuery.data])
  const driversById = useMemo(() => new Map((driversQuery.data ?? []).map((d) => [d.id, d])), [driversQuery.data])
  const vansById = useMemo(() => new Map((vansQuery.data ?? []).map((v) => [v.id, v])), [vansQuery.data])
  const assignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data])

  const today = useMemo(() => localISODate(), [])
  const statusOf = (a: Assignment): { label: string; tone: BadgeTone; current: boolean } => {
    if (a.end_date && calendarDateOf(a.end_date) < today) return { label: 'Ended', tone: 'neutral', current: false }
    if (calendarDateOf(a.start_date) > today) return { label: `Starts ${formatCalendarMonthDay(a.start_date)}`, tone: 'info', current: false }
    return { label: 'Active', tone: 'success', current: true }
  }

  const current = assignments.filter((a) => statusOf(a).current)
  const unassigned = (studentsQuery.data ?? []).filter((s) => !current.some((a) => a.student_id === s.id))

  // One-off schedule changes this week, across current assignments.
  const week = useMemo(() => weekBounds(), [])
  const overrideQueries = useQueries({
    queries: current.map((a) => ({
      queryKey: ['assignment-overrides', a.id],
      queryFn: () => api.get<ScheduleOverride[]>(`/assignments/${a.id}/overrides`),
    })),
  })
  const overridesThisWeek = overrideQueries.flatMap((q, i) =>
    (q.data ?? [])
      .filter((o) => calendarDateOf(o.override_date) >= week.from && calendarDateOf(o.override_date) <= week.to)
      .map((o) => ({ o, a: current[i] })),
  )
  const nextOverrideFor = new Map<string, ScheduleOverride>()
  overrideQueries.forEach((q, i) => {
    const upcoming = (q.data ?? []).filter((o) => calendarDateOf(o.override_date) >= today).sort((x, y) => x.override_date.localeCompare(y.override_date))[0]
    if (upcoming) nextOverrideFor.set(current[i].id, upcoming)
  })

  // ---- New assignment ----
  const [studentId, setStudentId] = useState('')
  const [driverId, setDriverId] = useState('')
  const [vanId, setVanId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [shiftPeriod, setShiftPeriod] = useState<AssignmentShiftPeriod>('both')
  const [pickupTime, setPickupTime] = useState('')
  const [dropoffTime, setDropoffTime] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)

  // "New assignment" on the dashboard lands here with the form open.
  useEffect(() => {
    if ((location.state as { create?: boolean } | null)?.create) {
      setShowAddModal(true)
      navigate(location.pathname, { replace: true, state: null })
    }
  }, [location, navigate])

  function openNew(forStudent = '') {
    setStudentId(forStudent)
    setFormError(null)
    setShowAddModal(true)
  }

  // Live conflict filtering (§7 item 3) — computed against today when no start date is
  // picked yet, so the picker is already narrowed before the user gets to the date field.
  const range = useMemo(() => ({ start_date: startDate || today, end_date: null }), [startDate, today])
  const lockedVanId = driverId ? driverCurrentVanId(assignments, driverId, range) : null
  const excludedVanIds = driverId ? vansTakenByOtherDrivers(assignments, driverId, range) : new Set<string>()
  const excludedStudentIds = driverId ? studentsTakenByOtherDrivers(assignments, driverId, range, shiftPeriod) : new Set<string>()

  // The driver's own current van (if any) is the only valid choice — lock the picker to it
  // rather than let the admin pick a van that doesn't match reality.
  useEffect(() => {
    setVanId(lockedVanId ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockedVanId])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['assignments'] })

  const createAssignment = useMutation({
    mutationFn: () =>
      api.post<Assignment>('/assignments', {
        student_id: studentId,
        driver_user_id: driverId,
        van_id: vanId,
        start_date: startDate,
        shift_period: shiftPeriod,
        pickup_time: pickupTime || undefined,
        dropoff_time: dropoffTime || undefined,
      }),
    onSuccess: (a) => {
      invalidate()
      toast.show(`${studentsById.get(a.student_id)?.full_name ?? 'Student'} assigned to ${driversById.get(a.driver_user_id)?.full_name ?? 'driver'}`)
      setStudentId('')
      setDriverId('')
      setVanId('')
      setStartDate('')
      setShiftPeriod('both')
      setPickupTime('')
      setDropoffTime('')
      setShowAddModal(false)
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Could not create assignment.'),
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    createAssignment.mutate()
  }

  // ---- Table ----
  const [q, setQ] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)

  const nameOf = (a: Assignment) => (studentsQuery.isLoading ? '…' : (studentsById.get(a.student_id)?.full_name ?? '(deleted student)'))
  const driverOf = (a: Assignment) => (driversQuery.isLoading ? '…' : (driversById.get(a.driver_user_id)?.full_name ?? '(deleted driver)'))
  const plateOf = (a: Assignment) => (vansQuery.isLoading ? '…' : (vansById.get(a.van_id)?.license_plate ?? '(deleted van)'))
  const times = (a: Assignment) =>
    [a.shift_period !== 'afternoon' ? formatTimeOfDay(a.pickup_time) : null, a.shift_period !== 'morning' ? formatTimeOfDay(a.dropoff_time) : null]
      .filter(Boolean)
      .join(' · ')
  const dateRange = (a: Assignment) => `${formatCalendarMonthDay(a.start_date)} – ${a.end_date ? formatCalendarMonthDay(a.end_date) : 'ongoing'}`

  // Current first, then upcoming, then ended; newest start first inside each.
  const order = (a: Assignment) => (statusOf(a).current ? 0 : statusOf(a).label === 'Ended' ? 2 : 1)
  const sorted = [...assignments].sort((x, y) => order(x) - order(y) || y.start_date.localeCompare(x.start_date))
  const visibleAssignments = sorted.filter((a) => matches(q, nameOf(a), driverOf(a), plateOf(a), SHIFT_LABELS[a.shift_period]))
  const visibleUnassigned = unassigned.filter((s) => matches(q, s.full_name))
  const detail = assignments.find((a) => a.id === detailId) ?? null
  const loading = assignmentsQuery.isLoading || studentsQuery.isLoading
  const nothing = !loading && assignments.length === 0 && unassigned.length === 0

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Assignments">
        <SearchField value={q} onChange={setQ} placeholder="Search assignments" />
        <Button onClick={() => openNew()}>
          <span className="material-symbols-outlined !text-[18px]">add</span>
          New assignment
        </Button>
      </PageTopBar>

      <PageIntro>Who drives which student, on which shift, and for how long.</PageIntro>

      <StatRow>
        <StatCard
          label="Active assignments"
          value={current.length}
          sub={`For ${new Set(current.map((a) => a.student_id)).size} students`}
        />
        <StatCard
          label="Schedule changes this week"
          value={overridesThisWeek.length}
          tone={overridesThisWeek.length ? 'caution' : 'default'}
          sub={
            overridesThisWeek.length
              ? overridesThisWeek
                  .slice(0, 3)
                  .map(({ o, a }) => `${formatCalendarMonthDay(o.override_date)} ${studentsById.get(a.student_id)?.full_name.split(' ')[0] ?? ''}`)
                  .join(' · ')
              : 'No one-off changes'
          }
        />
        <StatCard
          label="Unassigned students"
          value={unassigned.length}
          tone={unassigned.length ? 'alert' : 'default'}
          sub={unassigned.length ? unassigned.map((s) => s.full_name).join(', ') : 'Every student has a driver'}
        />
      </StatRow>

      <TableCard
        template={TEMPLATE}
        minWidth={880}
        columns={[{ label: 'Student' }, { label: 'Driver · van' }, { label: 'Shift' }, { label: 'Usual times' }, { label: 'Date range' }, { label: 'Status' }]}
      >
        {loading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : nothing ? (
          <EmptyState
            icon="assignment"
            title="No students to assign yet"
            body="Add students first, then give each one a driver and van here."
          />
        ) : visibleAssignments.length === 0 && visibleUnassigned.length === 0 ? (
          <NoMatches q={q} hint="Search looks at students, drivers, plates and shifts." onClear={() => setQ('')} />
        ) : (
          <>
            {visibleUnassigned.map((s) => (
              <TableRow key={`u-${s.id}`} template={TEMPLATE} onClick={() => openNew(s.id)}>
                <NameCell name={s.full_name} sub={s.grade ? `Grade ${s.grade}` : undefined} />
                <span className="text-muted">No driver</span>
                <span className="text-muted">—</span>
                <span className="text-muted">—</span>
                <span className="text-muted">—</span>
                <span className="flex items-center justify-between gap-2" onClick={stop}>
                  <StatusBadge tone="alert" label="Unassigned" />
                  <Button size="sm" variant="outline" onClick={() => openNew(s.id)}>
                    Assign
                  </Button>
                </span>
              </TableRow>
            ))}
            {visibleAssignments.map((a) => {
              const st = statusOf(a)
              const next = nextOverrideFor.get(a.id)
              return (
                <TableRow key={a.id} template={TEMPLATE} selected={detailId === a.id} onClick={() => setDetailId(a.id)} className={st.label === 'Ended' ? 'opacity-60' : ''}>
                  <NameCell name={nameOf(a)} sub={studentsById.get(a.student_id)?.grade ? `Grade ${studentsById.get(a.student_id)?.grade}` : undefined} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-medium text-ink">{driverOf(a)}</span>
                    <span className="truncate text-[12px] text-muted">{plateOf(a)}</span>
                  </span>
                  <span className="text-ink-sub">{SHIFT_LABELS[a.shift_period]}</span>
                  <span className="text-ink-sub tabular">{times(a) || '—'}</span>
                  <span className="text-ink-sub tabular">{dateRange(a)}</span>
                  <span>
                    {st.current && next ? (
                      <StatusBadge
                        tone="caution"
                        label={calendarDateOf(next.override_date) === today ? 'Changed today' : `Change ${formatCalendarMonthDay(next.override_date)}`}
                      />
                    ) : (
                      <StatusBadge tone={st.tone} label={st.label} />
                    )}
                  </span>
                </TableRow>
              )
            })}
          </>
        )}
      </TableCard>

      {detail && (
        <AssignmentDrawer
          assignment={detail}
          studentName={nameOf(detail)}
          driverName={driverOf(detail)}
          van={vansById.get(detail.van_id) ?? null}
          status={statusOf(detail)}
          onClose={() => setDetailId(null)}
          onToast={toast.show}
        />
      )}

      {showAddModal && (
        <Modal title="New assignment" onClose={() => setShowAddModal(false)}>
          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <Field label="Student">
              <Select required value={studentId} onChange={(e) => setStudentId(e.target.value)}>
                <option value="">Select a student…</option>
                {(studentsQuery.data ?? [])
                  .filter((s) => s.id === studentId || !excludedStudentIds.has(s.id))
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
              </Select>
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Driver">
                <Select required value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                  <option value="">Select a driver…</option>
                  {(driversQuery.data ?? [])
                    .filter((d) => d.is_active || d.id === driverId)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.full_name}
                      </option>
                    ))}
                </Select>
              </Field>
              <Field label="Van">
                <Select required value={vanId} onChange={(e) => setVanId(e.target.value)} disabled={!!lockedVanId}>
                  <option value="">Select a van…</option>
                  {(vansQuery.data ?? [])
                    .filter((v) => (lockedVanId ? v.id === lockedVanId : !excludedVanIds.has(v.id)))
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.license_plate} · {v.brand} {v.model}
                      </option>
                    ))}
                </Select>
              </Field>
            </div>
            {lockedVanId && (
              <p className="text-[12px] text-muted">
                This driver is already driving {vansById.get(lockedVanId)?.license_plate ?? 'this van'} for this date range, so the van is locked to match.
              </p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Shift">
                <Select value={shiftPeriod} onChange={(e) => setShiftPeriod(e.target.value as AssignmentShiftPeriod)}>
                  <option value="both">Both shifts (full day)</option>
                  <option value="morning">Morning only</option>
                  <option value="afternoon">Afternoon only</option>
                </Select>
              </Field>
              <Field label="Start date">
                <Input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Usual pickup time">
                <Input type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} disabled={shiftPeriod === 'afternoon'} />
              </Field>
              <Field label="Usual drop-off time">
                <Input type="time" value={dropoffTime} onChange={(e) => setDropoffTime(e.target.value)} disabled={shiftPeriod === 'morning'} />
              </Field>
            </div>
            {formError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {formError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createAssignment.isPending}>
                {createAssignment.isPending ? 'Creating…' : 'Create assignment'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {toast.node}
    </div>
  )
}

function AssignmentDrawer({
  assignment: a,
  studentName,
  driverName,
  van,
  status,
  onClose,
  onToast,
}: {
  assignment: Assignment
  studentName: string
  driverName: string
  van: Van | null
  status: { label: string; tone: BadgeTone; current: boolean }
  onClose: () => void
  onToast: (msg: string) => void
}) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['assignments'] })
  const [editing, setEditing] = useState(false)
  const [editPickup, setEditPickup] = useState('')
  const [editDropoff, setEditDropoff] = useState('')
  const [editShift, setEditShift] = useState<AssignmentShiftPeriod>('both')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function startEdit() {
    setEditPickup(a.pickup_time ? a.pickup_time.slice(0, 5) : '')
    setEditDropoff(a.dropoff_time ? a.dropoff_time.slice(0, 5) : '')
    setEditShift(a.shift_period)
    setEditing(true)
  }

  const fail = (fallback: string) => (err: unknown) => setError(err instanceof ApiError ? err.message : fallback)

  const updateTimes = useMutation({
    mutationFn: () => api.patch<Assignment>(`/assignments/${a.id}`, { pickup_time: editPickup || null, dropoff_time: editDropoff || null, shift_period: editShift }),
    onSuccess: () => {
      invalidate()
      setEditing(false)
      onToast('Usual times saved')
    },
    onError: fail('Could not save the times.'),
  })

  const endAssignment = useMutation({
    mutationFn: () => api.patch<Assignment>(`/assignments/${a.id}`, { end_date: localISODate() }),
    onSuccess: () => {
      invalidate()
      onToast(`${studentName}'s assignment ends today`)
    },
    onError: fail('Could not end the assignment.'),
  })

  const deleteAssignment = useMutation({
    mutationFn: () => api.delete(`/assignments/${a.id}`),
    onSuccess: () => {
      invalidate()
      onClose()
      onToast('Assignment deleted')
    },
    onError: fail('Could not delete the assignment.'),
  })

  return (
    <Drawer
      eyebrow="DETAILS"
      title={studentName}
      subtitle={`${driverName} · ${van ? `${van.brand} ${van.model} · ${van.license_plate}` : 'no van'}`}
      onClose={onClose}
      footer={
        confirmDelete ? (
          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-ink">Delete this assignment? Use &ldquo;End today&rdquo; instead to keep its history.</span>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
              <Button variant="danger" disabled={deleteAssignment.isPending} onClick={() => deleteAssignment.mutate()}>
                {deleteAssignment.isPending ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" className="text-danger-ink" onClick={() => setConfirmDelete(true)}>
              <span className="material-symbols-outlined !text-[18px]">delete</span>
              Delete
            </Button>
            <div className="flex gap-2">
              {status.current && (
                <Button variant="outline" disabled={endAssignment.isPending} onClick={() => endAssignment.mutate()}>
                  End today
                </Button>
              )}
              <Button onClick={onClose}>Done</Button>
            </div>
          </div>
        )
      }
    >
      {error && (
        <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
          {error}
        </p>
      )}
      <DetailRows
        rows={[
          { k: 'Status', v: <StatusBadge tone={status.tone} label={status.label} /> },
          { k: 'Driver', v: driverName },
          { k: 'Van', v: van ? `${van.brand} ${van.model} · ${van.license_plate}` : '—' },
          { k: 'Starts', v: formatCalendarMonthDay(a.start_date) },
          { k: 'Ends', v: a.end_date ? formatCalendarMonthDay(a.end_date) : 'Ongoing' },
        ]}
      />

      <DrawerSection title="Shift and usual times">
        {editing ? (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              setError(null)
              updateTimes.mutate()
            }}
          >
            <Field label="Shift">
              <Select value={editShift} onChange={(e) => setEditShift(e.target.value as AssignmentShiftPeriod)}>
                <option value="both">Both shifts</option>
                <option value="morning">Morning only</option>
                <option value="afternoon">Afternoon only</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pickup">
                <Input type="time" value={editPickup} onChange={(e) => setEditPickup(e.target.value)} />
              </Field>
              <Field label="Drop-off">
                <Input type="time" value={editDropoff} onChange={(e) => setEditDropoff(e.target.value)} />
              </Field>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={updateTimes.isPending}>
                {updateTimes.isPending ? 'Saving…' : 'Save times'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="flex items-center justify-between gap-3 rounded-m border border-line px-3 py-2.5 text-[14px]">
            <span className="text-ink">
              {SHIFT_LABELS[a.shift_period]}
              <span className="text-muted">
                {a.shift_period !== 'afternoon' ? ` · pickup ${formatTimeOfDay(a.pickup_time)}` : ''}
                {a.shift_period !== 'morning' ? ` · drop-off ${formatTimeOfDay(a.dropoff_time)}` : ''}
              </span>
            </span>
            <Button size="sm" variant="outline" onClick={startEdit}>
              Edit
            </Button>
          </div>
        )}
      </DrawerSection>

      <OverridesSection assignmentId={a.id} onToast={onToast} />
    </Drawer>
  )
}

// One-off exceptions to the usual times for a single date (a different time and/or no ride).
function OverridesSection({ assignmentId, onToast }: { assignmentId: string; onToast: (msg: string) => void }) {
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
  const [error, setError] = useState<string | null>(null)

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
      onToast('Schedule change saved')
      setDate('')
      setPickup('')
      setDropoff('')
      setSkip(false)
      setNote('')
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the change.'),
  })

  const deleteOverride = useMutation({
    mutationFn: (id: string) => api.delete(`/assignments/${assignmentId}/overrides/${id}`),
    onSuccess: invalidate,
  })

  const list = [...(overridesQuery.data ?? [])].sort((x, y) => x.override_date.localeCompare(y.override_date))

  return (
    <DrawerSection title="Schedule changes">
      {overridesQuery.isLoading ? (
        <p className="text-[13px] text-muted">Loading…</p>
      ) : list.length === 0 ? (
        <InlineEmpty icon="event_repeat" text="No one-off changes. Add a late start, early release or a day off below." />
      ) : (
        list.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-2 border-b border-divider py-2 text-[14px]">
            <span className="min-w-0 text-ink-sub">
              <span className="font-semibold text-ink">{formatCalendarMonthDay(o.override_date)}</span>
              {' · '}
              {o.skip ? 'No ride' : [o.pickup_time && `pickup ${formatTimeOfDay(o.pickup_time)}`, o.dropoff_time && `drop-off ${formatTimeOfDay(o.dropoff_time)}`].filter(Boolean).join(', ')}
              {o.note ? ` (${o.note})` : ''}
            </span>
            <Button size="sm" variant="ghost" className="text-danger-ink" disabled={deleteOverride.isPending} onClick={() => deleteOverride.mutate(o.id)}>
              Remove
            </Button>
          </div>
        ))
      )}
      <form
        className="mt-2 flex flex-col gap-2 rounded-m border border-line p-3"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          if (date) addOverride.mutate()
        }}
      >
        <div className="grid grid-cols-3 gap-2">
          <Field label="Date">
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Pickup">
            <input type="time" value={pickup} onChange={(e) => setPickup(e.target.value)} disabled={skip} className={`${FIELD_CLASS} disabled:opacity-50`} />
          </Field>
          <Field label="Drop-off">
            <input type="time" value={dropoff} onChange={(e) => setDropoff(e.target.value)} disabled={skip} className={`${FIELD_CLASS} disabled:opacity-50`} />
          </Field>
        </div>
        <Input placeholder="Note (e.g. late start)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} className="h-4 w-4 accent-amber" />
            No ride that day
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={addOverride.isPending}>
            {addOverride.isPending ? 'Saving…' : 'Add change'}
          </Button>
        </div>
        {error && <p className="text-[12px] text-alert-fg">{error}</p>}
      </form>
    </DrawerSection>
  )
}
