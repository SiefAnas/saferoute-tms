import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { localISODate } from '../../lib/localDate'
import { firstName, greeting, isAssignmentActiveToday, isToday } from '../../lib/format'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { Button } from '../../components/Button'
import { IconTile } from '../../components/EmptyState'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { Avatar, FilterChip, Segmented, StatCard } from '../../components/Records'
import { PageTopBar } from '../../layouts/TopBar'
import type {
  AbsentTodayEntry,
  Assignment,
  DriverSession,
  PayRule,
  PublicUser,
  SchoolSummary,
  ShiftPeriod,
  Student,
  Trip,
  Van,
} from '../../types/api'

const ALERT_STALE_HOURS = 10
const DISMISS_KEY = `saferoute-dash-dismissed-${localISODate()}`

type DriverFilter = 'all' | 'on' | 'off'

interface Attention {
  id: string
  icon: string
  tone: BadgeTone
  title: string
  sub: string
}

const TILE: Record<BadgeTone, string> = {
  alert: 'bg-alert-bg text-alert-fg',
  caution: 'bg-caution-bg text-caution-fg',
  neutral: 'bg-neutral-bg text-neutral-fg',
  success: 'bg-success-bg text-success-fg',
  info: 'bg-info-bg text-info-fg',
  next: 'bg-next-bg text-next-fg',
}

function readDismissed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

// Company dashboard (design 4a): an at-a-glance view of one run (Morning or Afternoon), built
// only from data the backend already serves: sessions, today's trips and their confirmation
// state, today's skips/no-shows, assignments and pay rules.
//
// BACKEND GAPS (see DESIGN_REPORT.md): there's no dashboard summary endpoint, so this adds up
// the list endpoints client-side; driver lateness needs route order, so the driver filter is
// "On shift / Not in" instead of "On time / Late"; the live map needs a map provider and is a
// placeholder.
export function CompanyAdminDashboard() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [run, setRun] = useState<ShiftPeriod>(() => (new Date().getHours() < 12 ? 'morning' : 'afternoon'))
  const [filter, setFilter] = useState<DriverFilter>('all')
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const schoolsQuery = useQuery({ queryKey: ['schools'], queryFn: () => api.get<SchoolSummary[]>('/schools') })
  const sessionsQuery = useQuery({ queryKey: ['sessions', 'all'], queryFn: () => api.get<DriverSession[]>('/sessions') })
  const tripsQuery = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const absentQuery = useQuery({ queryKey: ['dashboard-absent-today'], queryFn: () => api.get<AbsentTodayEntry[]>('/dashboard/absent-today') })
  const rulesQuery = useQuery({ queryKey: ['payroll-rules'], queryFn: () => api.get<PayRule[]>('/payroll/rules') })

  const drivers = useMemo(() => (driversQuery.data ?? []).filter((d) => d.is_active), [driversQuery.data])
  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data])
  const absent = useMemo(() => absentQuery.data ?? [], [absentQuery.data])

  const view = useMemo(() => {
    const inRun = (a: Assignment) => isAssignmentActiveToday(a.start_date, a.end_date) && (a.shift_period === run || a.shift_period === 'both')
    const runAssignments = (assignmentsQuery.data ?? []).filter(inRun)
    const sessionUser = new Map(sessions.map((s) => [s.id, s.user_id]))
    const runTrips = (tripsQuery.data ?? []).filter((t) => isToday(t.created_at) && t.shift_period === run)
    const expectedStudents = new Set(runAssignments.map((a) => a.student_id))
    const done = new Set(runTrips.map((t) => t.student_id).filter((id) => expectedStudents.has(id))).size

    const vans = new Map((vansQuery.data ?? []).map((v) => [v.id, v]))
    const rows = drivers.map((d) => {
      const mine = runAssignments.filter((a) => a.driver_user_id === d.id)
      const open = sessions.find((s) => s.user_id === d.id && s.check_out_at === null)
      const endedRun = sessions.some((s) => s.user_id === d.id && s.shift_period === run && s.check_out_at && isToday(s.check_in_at))
      const handled = new Set(runTrips.filter((t) => sessionUser.get(t.session_id) === d.id).map((t) => t.student_id)).size
      const van = mine[0] ? vans.get(mine[0].van_id) : undefined
      let status: { label: string; tone: BadgeTone; on: boolean }
      if (open && open.shift_period === run) status = { label: 'On shift', tone: 'success', on: true }
      else if (open) status = { label: 'Other shift', tone: 'info', on: true }
      else if (endedRun) status = { label: 'Shift ended', tone: 'neutral', on: false }
      else if (mine.length > 0) status = { label: 'Not in', tone: 'caution', on: false }
      else status = { label: 'No stops', tone: 'neutral', on: false }
      return { driver: d, stops: mine.length, handled, van, status, open }
    })
    const assignedDrivers = rows.filter((r) => r.stops > 0)
    const onShift = rows.filter((r) => r.open?.shift_period === run).length
    const notIn = assignedDrivers.filter((r) => r.status.label === 'Not in')
    const waiting = runTrips.filter((t) => t.status === 'pending').length
    return { expected: expectedStudents.size, done, rows, assignedDrivers, onShift, notIn, waiting }
  }, [run, assignmentsQuery.data, tripsQuery.data, sessions, drivers, vansQuery.data])

  const skipped = absent.filter((a) => a.type === 'parent_skipped').length
  const noShows = absent.filter((a) => a.type === 'driver_no_show').length
  const pct = view.expected ? Math.round((view.done / view.expected) * 100) : 0
  const runName = run === 'morning' ? 'Morning' : 'Afternoon'

  const studentById = useMemo(() => new Map((studentsQuery.data ?? []).map((s) => [s.id, s])), [studentsQuery.data])
  const schoolName = useMemo(() => new Map((schoolsQuery.data ?? []).map((s) => [s.id, s.name])), [schoolsQuery.data])

  const attention: Attention[] = useMemo(() => {
    const items: Attention[] = []
    for (const a of absent.filter((x) => x.type === 'driver_no_show')) {
      items.push({ id: `noshow-${a.student_id}-${a.at}`, icon: 'person_off', tone: 'alert', title: `${a.student_name}: no-show`, sub: `Reported by the driver at ${clock(a.at)}` })
    }
    if (view.waiting > 0) {
      items.push({
        id: `waiting-${run}-${view.waiting}`,
        icon: 'hourglass_top',
        tone: 'caution',
        title: `${view.waiting} ${view.waiting === 1 ? 'trip' : 'trips'} waiting on schools`,
        sub: `${runName} run · auto-completes after 5 min`,
      })
    }
    for (const r of view.notIn) {
      items.push({
        id: `notin-${run}-${r.driver.id}`,
        icon: 'person_alert',
        tone: 'caution',
        title: `${r.driver.full_name} isn't checked in`,
        sub: `${r.stops} ${run} ${r.stops === 1 ? 'stop' : 'stops'} assigned`,
      })
    }
    const now = Date.now()
    for (const s of sessions.filter((x) => x.check_out_at === null && now - new Date(x.check_in_at).getTime() > ALERT_STALE_HOURS * 3_600_000)) {
      const name = drivers.find((d) => d.id === s.user_id)?.full_name ?? 'A driver'
      items.push({
        id: `stale-${s.id}`,
        icon: 'schedule',
        tone: 'alert',
        title: `${name} is still checked in`,
        sub: `Since ${new Date(s.check_in_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`,
      })
    }
    const rules = new Set((rulesQuery.data ?? []).map((r) => r.driver_id))
    const missing = drivers.filter((d) => !rules.has(d.id))
    if (rulesQuery.data && missing.length > 0) {
      items.push({
        id: `rates-${missing.map((d) => d.id).join('.')}`,
        icon: 'payments',
        tone: 'neutral',
        title: `${missing.length} ${missing.length === 1 ? 'driver needs' : 'drivers need'} a pay rate`,
        sub: missing.map((d) => d.full_name).join(', '),
      })
    }
    return items
  }, [absent, view, run, runName, sessions, drivers, rulesQuery.data])

  const visibleAttention = attention.filter((a) => !dismissed.has(a.id))

  function updateDismissed(next: Set<string>) {
    setDismissed(next)
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify([...next]))
    } catch {
      // Private mode: dismissals just won't survive a reload.
    }
  }

  const filteredRows = view.rows.filter((r) => (filter === 'all' ? true : filter === 'on' ? r.status.on : !r.status.on))
  const openSessions = sessions.filter((s) => s.check_out_at === null)
  const withGps = openSessions.filter((s) => s.check_in_lat).length

  return (
    <div className="flex flex-col gap-4">
      <PageTopBar
        title={`${greeting()}, ${firstName(user?.full_name)}`}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
      >
        <Segmented
          label="Run"
          value={run}
          onChange={setRun}
          options={[
            { value: 'morning', label: 'Morning' },
            { value: 'afternoon', label: 'Afternoon' },
          ]}
        />
        <Button onClick={() => navigate('/company/assignments', { state: { create: true } })}>
          <span className="material-symbols-outlined !text-[18px]">add</span>
          New assignment
        </Button>
      </PageTopBar>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-2 rounded-card bg-hero px-5 py-4 text-hero-ink shadow-hero sm:col-span-2 xl:col-span-1">
          <div className="flex justify-between text-[13px] text-hero-muted">
            <span>{runName} run · trips done</span>
            <span className="font-semibold text-amber-soft">{pct}%</span>
          </div>
          <span className="text-hero-figure leading-none text-amber-soft">
            {view.done} <span className="text-[15px] font-medium tracking-normal text-hero-sub">of {view.expected} students</span>
          </span>
          <div className="h-1.5 overflow-hidden rounded-[3px] bg-sidebar-chip">
            <div className="h-full rounded-[3px] bg-amber transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <StatCard
          label="Drivers on shift"
          value={
            <>
              {view.onShift}
              <span className="text-[16px] text-muted">/{view.assignedDrivers.length}</span>
            </>
          }
          sub={view.notIn.length === 0 ? 'Everyone assigned is in' : `${view.notIn.length} not checked in`}
        />
        <StatCard label="Waiting on schools" value={view.waiting} tone={view.waiting > 0 ? 'caution' : 'default'} sub="Auto-complete after 5 min" />
        <StatCard label="Absent today" value={absent.length} tone={absent.length > 0 ? 'alert' : 'default'} sub={`${skipped} skipped · ${noShows} no-show`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex min-h-[260px] flex-col overflow-hidden">
            <CardHeader className="!py-3">
              <CardTitle>Live fleet</CardTitle>
              <span className="flex items-center gap-1.5 text-[12px] text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-success-fg" />
                {withGps} of {openSessions.length} on shift shared a check-in location
              </span>
            </CardHeader>
            {/* Placeholder: a real map needs a map provider (not set up). Check-in GPS is already
                stored on sessions, so pins can come from there once one is chosen. */}
            <div className="flex flex-1 items-center justify-center bg-[repeating-linear-gradient(135deg,var(--color-table-head)_0_12px,var(--color-bg)_12px_24px)] p-6">
              <div className="flex w-full max-w-sm flex-col items-center gap-2 rounded-m bg-surface px-5 py-4 text-center shadow-card">
                <IconTile icon="map" tone="neutral" />
                <span className="text-[14px] font-semibold text-ink">Map coming later</span>
                <span className="text-[12px] text-muted">
                  Van pins will use each driver&apos;s check-in location. This needs a map provider, which isn&apos;t set up yet.
                </span>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1fr_130px] gap-3 bg-table-head px-[18px] py-[9px] text-[12px] font-semibold text-muted">
              <span>Absent today</span>
              <span>School</span>
              <span>Reason</span>
            </div>
            {absentQuery.isLoading ? (
              <p className="border-t border-divider px-[18px] py-3 text-[13px] text-muted">Loading…</p>
            ) : absent.length === 0 ? (
              <div className="flex items-center gap-3 border-t border-divider px-[18px] py-3.5">
                <IconTile icon="event_available" tone="success" />
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-ink">Everyone&apos;s riding today</span>
                  <span className="text-[12px] text-muted">No parent skips or no-shows so far.</span>
                </div>
              </div>
            ) : (
              absent.map((a, i) => {
                const st = studentById.get(a.student_id)
                return (
                  <div
                    key={`${a.student_id}-${i}`}
                    className="grid h-[38px] grid-cols-[1.4fr_1fr_130px] items-center gap-3 border-t border-divider px-[18px] text-[13px]"
                  >
                    <span className="truncate font-semibold text-ink">{a.student_name}</span>
                    <span className="truncate text-ink-sub">{st ? (schoolName.get(st.school_id) ?? '—') : '—'}</span>
                    <span>
                      <StatusBadge tone={a.type === 'parent_skipped' ? 'info' : 'alert'} label={a.type === 'parent_skipped' ? 'Parent skipped' : 'No-show'} />
                    </span>
                  </div>
                )
              })
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex max-h-[420px] min-h-0 flex-col overflow-hidden">
            <div className="flex flex-col gap-2.5 border-b border-divider px-4 pt-3 pb-2.5">
              <div className="flex items-baseline justify-between">
                <CardTitle>Drivers</CardTitle>
                <span className="text-[12px] text-muted">{drivers.length} active</span>
              </div>
              <div className="flex gap-1">
                <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
                  All
                </FilterChip>
                <FilterChip active={filter === 'on'} onClick={() => setFilter('on')}>
                  On shift
                </FilterChip>
                <FilterChip active={filter === 'off'} onClick={() => setFilter('off')}>
                  Not in
                </FilterChip>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredRows.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-muted">{driversQuery.isLoading ? 'Loading…' : 'No drivers match this filter.'}</p>
              ) : (
                filteredRows.map((r, i) => (
                  <div key={r.driver.id} className={`grid grid-cols-[32px_1fr_auto] items-center gap-2.5 px-4 py-[9px] ${i ? 'border-t border-divider' : ''}`}>
                    <Avatar name={r.driver.full_name} />
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[14px] font-semibold text-ink">{r.driver.full_name}</span>
                      <span className="truncate text-[12px] text-muted">
                        {r.van ? r.van.license_plate : 'No van'}
                        {r.stops > 0 ? ` · ${r.handled} of ${r.stops} ${run === 'morning' ? 'pickups' : 'drop-offs'}` : ''}
                      </span>
                    </div>
                    <StatusBadge tone={r.status.tone} label={r.status.label} />
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="overflow-hidden">
            <CardHeader className="!px-4 !py-3">
              <CardTitle>Needs attention</CardTitle>
              <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-alert-bg px-1.5 text-[12px] font-bold text-alert-fg">
                {visibleAttention.length}
              </span>
            </CardHeader>
            {visibleAttention.length === 0 ? (
              <div className="flex items-center gap-3 px-4 py-3.5">
                <IconTile icon="task_alt" tone="success" />
                <div className="flex flex-1 flex-col">
                  <span className="text-[13px] font-semibold text-ink">All clear</span>
                  <span className="text-[12px] text-muted">Nothing needs you right now.</span>
                </div>
                {dismissed.size > 0 && attention.length > 0 && (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => updateDismissed(new Set())}>
                    Show again
                  </Button>
                )}
              </div>
            ) : (
              visibleAttention.map((it, i) => (
                <div key={it.id} className={`grid grid-cols-[32px_1fr_28px] items-center gap-2.5 px-4 py-2.5 ${i ? 'border-t border-divider' : ''}`}>
                  <span className={`flex h-8 w-8 items-center justify-center rounded-btn ${TILE[it.tone]}`}>
                    <span className="material-symbols-outlined !text-[18px]">{it.icon}</span>
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[13px] font-semibold text-ink">{it.title}</span>
                    <span className="truncate text-[12px] text-muted">{it.sub}</span>
                  </div>
                  <button
                    type="button"
                    aria-label={`Dismiss: ${it.title}`}
                    title="Dismiss"
                    onClick={() => updateDismissed(new Set([...dismissed, it.id]))}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-[7px] text-muted hover:bg-surface-2"
                  >
                    <span className="material-symbols-outlined !text-[18px]">check</span>
                  </button>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
