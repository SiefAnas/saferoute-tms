import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { isToday, isAssignmentActiveToday, formatDuration, formatMoney, formatRelativeTime } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import type {
  AbsentTodayEntry,
  Assignment,
  CompanyPayrollSummary,
  DriverSession,
  PublicUser,
  Student,
  Van,
} from '../../types/api'

// Company Admin Dashboard, redesigned (2026-08-28) per Anas's reference mockup — adapted to
// real data, not cloned. Two things in the reference had no real backing data and needed an
// honest substitute rather than being faked outright:
//   - "Last Sync" (implies live device telemetry) -> "Last Activity", backed by the most
//     recent real session check-in/check-out timestamp.
//   - "Recent Alerts" (mockup example: "VAN-2001 - Speeding", telemetry we don't have) ->
//     real alerts derived from actual data: a driver checked in unusually long ago and still
//     hasn't checked out. Flagged as ASSUMPTION — no other "alert" concept exists yet.
//   - "Fleet Summary" / "operational van count": there's no operational/maintenance status
//     field on vans, so this is just the real fleet size, not an operational/down split.
function currentWeekRange() {
  const now = new Date()
  const day = now.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday)
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  return { from: iso(monday), to: iso(nextMonday) }
}

const ALERT_STALE_HOURS = 10

export function CompanyAdminDashboard() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const sessionsQuery = useQuery({ queryKey: ['sessions', 'all'], queryFn: () => api.get<DriverSession[]>('/sessions') })
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const absentQuery = useQuery({ queryKey: ['dashboard-absent-today'], queryFn: () => api.get<AbsentTodayEntry[]>('/dashboard/absent-today') })
  const { from, to } = useMemo(() => currentWeekRange(), [])
  const payrollQuery = useQuery({
    queryKey: ['payroll-summary-company', from, to],
    queryFn: () => api.get<CompanyPayrollSummary>(`/payroll/summary/company?from=${from}&to=${to}`),
  })

  const vanPlate = useMemo(() => {
    const map = new Map((vansQuery.data ?? []).map((v) => [v.id, v.license_plate]))
    return (id: string) => map.get(id) ?? '-'
  }, [vansQuery.data])

  // Each driver's current van, derived the same way as Students/Fleet: most-recently-created
  // assignment active today.
  const currentVanForDriver = useMemo(() => {
    const byDriver = new Map<string, Assignment>()
    for (const a of assignmentsQuery.data ?? []) {
      if (!isAssignmentActiveToday(a.start_date, a.end_date)) continue
      const existing = byDriver.get(a.driver_user_id)
      if (!existing || a.created_at > existing.created_at) byDriver.set(a.driver_user_id, a)
    }
    return (driverId: string) => byDriver.get(driverId) ?? null
  }, [assignmentsQuery.data])

  const driverRows = useMemo(() => {
    const sessions = sessionsQuery.data ?? []
    return (driversQuery.data ?? []).map((driver) => {
      const mine = sessions.filter((s) => s.user_id === driver.id)
      const open = mine.find((s) => s.check_out_at === null)
      const completedToday = mine
        .filter((s) => s.check_out_at && isToday(s.check_in_at))
        .reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)
      const liveElapsed = open && isToday(open.check_in_at) ? (Date.now() - new Date(open.check_in_at).getTime()) / 60_000 : 0
      const lastActivity = mine
        .map((s) => s.check_out_at ?? s.check_in_at)
        .sort()
        .at(-1)
      const van = currentVanForDriver(driver.id)
      return {
        driver,
        open,
        minutesToday: completedToday + Math.max(0, liveElapsed),
        lastActivity,
        vanPlate: van ? vanPlate(van.van_id) : null,
      }
    })
  }, [driversQuery.data, sessionsQuery.data, currentVanForDriver, vanPlate])

  const staleOpenSessions = useMemo(() => {
    const now = Date.now()
    return (sessionsQuery.data ?? [])
      .filter((s) => s.check_out_at === null && now - new Date(s.check_in_at).getTime() > ALERT_STALE_HOURS * 60 * 60_000)
      .map((s) => ({ session: s, driverName: (driversQuery.data ?? []).find((d) => d.id === s.user_id)?.full_name ?? 'Unknown driver' }))
  }, [sessionsQuery.data, driversQuery.data])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Dispatch Overview</h1>

      <DashboardSearch drivers={driversQuery.data ?? []} vans={vansQuery.data ?? []} students={studentsQuery.data ?? []} sessions={sessionsQuery.data ?? []} />

      <Card className="flex flex-col overflow-hidden">
        <CardHeader>
          <h2 className="text-title-lg text-primary">Live Driver Status</h2>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="border-b border-outline-variant bg-surface-container-low">
              <tr>
                {['Driver Name', 'Status', 'Hours Today', 'Van', 'Last Activity'].map((h) => (
                  <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant">
              {driverRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-4 text-body-md text-on-surface-variant">
                    {driversQuery.isLoading ? 'Loading…' : 'No drivers yet.'}
                  </td>
                </tr>
              ) : (
                driverRows.map(({ driver, open, minutesToday, lastActivity, vanPlate: plate }) => (
                  <tr key={driver.id} className="hover:bg-surface-container-low">
                    <td className="px-6 py-3 text-body-md font-medium">{driver.full_name}</td>
                    <td className="px-6 py-3">
                      {open ? <StatusBadge tone="success" label="Checked In" pulse /> : <StatusBadge tone="neutral" label="Checked Out" />}
                    </td>
                    <td className="px-6 py-3 text-data-mono text-secondary">{formatDuration(minutesToday)}</td>
                    <td className="px-6 py-3 text-data-mono text-secondary">{plate ?? '-'}</td>
                    <td className="px-6 py-3 text-body-md text-on-surface-variant">{lastActivity ? formatRelativeTime(lastActivity) : '-'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-title-lg text-primary">Fleet Summary</h2>
            <span className="material-symbols-outlined text-secondary">local_shipping</span>
          </div>
          <p className="text-headline-md font-bold text-on-surface">{vansQuery.data?.length ?? 0}</p>
          <p className="text-body-md text-on-surface-variant">vans in fleet</p>
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-title-lg text-primary">Recent Alerts</h2>
            <span className="material-symbols-outlined text-secondary">warning</span>
          </div>
          {staleOpenSessions.length === 0 ? (
            <p className="text-body-md text-on-surface-variant">No alerts.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {staleOpenSessions.map(({ session, driverName }) => (
                <li key={session.id} className="flex items-start gap-2 text-body-md">
                  <span className="material-symbols-outlined !text-[18px] text-error">warning</span>
                  <span>
                    {driverName} checked in {formatRelativeTime(session.check_in_at)}, not yet checked out.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-title-lg text-primary">Absent / Late Today</h2>
            <span className="material-symbols-outlined text-secondary">event_busy</span>
          </div>
          {absentQuery.isLoading ? (
            <p className="text-body-md text-on-surface-variant">Loading…</p>
          ) : (absentQuery.data ?? []).length === 0 ? (
            <p className="text-body-md text-on-surface-variant">No skips or no-shows reported today.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {(absentQuery.data ?? []).map((e, i) => (
                <li key={`${e.student_id}-${i}`} className="flex items-start justify-between text-body-md">
                  <span>
                    {e.student_name}:{' '}
                    <span className="text-on-surface-variant">
                      {e.type === 'parent_skipped' ? 'parent skipped pickup' : 'driver reported no-show'}
                    </span>
                  </span>
                  <span className="text-label-md text-on-surface-variant">{formatRelativeTime(e.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-title-lg text-primary">Payroll Summary</h2>
            <span className="material-symbols-outlined text-secondary">payments</span>
          </div>
          <p className="mb-2 text-label-md text-on-surface-variant uppercase">This week</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-outline-variant bg-surface-container p-3">
              <p className="text-label-md text-secondary uppercase">Weekly Total</p>
              <p className="text-title-lg font-bold">{formatMoney(payrollQuery.data?.total_pay_cents ?? 0)}</p>
            </div>
            <div className="rounded-lg border border-outline-variant bg-surface-container p-3">
              <p className="text-label-md text-secondary uppercase">Total Hours</p>
              <p className="text-title-lg font-bold">{((payrollQuery.data?.total_minutes ?? 0) / 60).toFixed(1)}h</p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

// Typeahead search across drivers/vans/students (2026-08-28) — client-side filtering of
// already-loaded data per Anas's explicit instruction, no new backend endpoint.
function DashboardSearch({
  drivers,
  vans,
  students,
  sessions,
}: {
  drivers: PublicUser[]
  vans: Van[]
  students: Student[]
  sessions: DriverSession[]
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()

  const openDriverIds = useMemo(() => new Set(sessions.filter((s) => s.check_out_at === null).map((s) => s.user_id)), [sessions])

  const matchedDrivers = q ? drivers.filter((d) => d.full_name.toLowerCase().includes(q) || d.email.toLowerCase().includes(q)) : []
  const matchedVans = q
    ? vans.filter((v) => v.license_plate.toLowerCase().includes(q) || v.brand.toLowerCase().includes(q) || v.model.toLowerCase().includes(q))
    : []
  const matchedStudents = q ? students.filter((s) => s.full_name.toLowerCase().includes(q)) : []

  return (
    <Card className="p-5">
      <div className="relative">
        <span className="material-symbols-outlined absolute top-1/2 left-3 -translate-y-1/2 text-on-surface-variant">search</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search drivers, vans, or students…"
          className="h-12 w-full rounded-lg border border-outline-variant bg-surface-container-lowest py-2 pr-4 pl-11 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
        />
      </div>

      {q && (
        <div className="mt-4 flex flex-col gap-5">
          <SearchGroup title={`Drivers (${matchedDrivers.length})`} icon="badge">
            {matchedDrivers.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border border-outline-variant p-3">
                <span className="text-body-md font-medium">{d.full_name}</span>
                {openDriverIds.has(d.id) ? <StatusBadge tone="success" label="Checked In" /> : <StatusBadge tone="neutral" label="Checked Out" />}
              </div>
            ))}
          </SearchGroup>

          <SearchGroup title={`Vans (${matchedVans.length})`} icon="local_shipping">
            {matchedVans.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-lg border border-outline-variant p-3">
                <span className="text-data-mono font-medium">{v.license_plate}</span>
                <span className="text-body-md text-on-surface-variant">
                  {v.brand} {v.model}
                </span>
              </div>
            ))}
          </SearchGroup>

          <SearchGroup title={`Students (${matchedStudents.length})`} icon="groups">
            {matchedStudents.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-outline-variant p-3">
                <span className="text-body-md font-medium">{s.full_name}</span>
                <span className="text-body-md text-on-surface-variant">{s.grade ? `Grade ${s.grade}` : ''}</span>
              </div>
            ))}
          </SearchGroup>

          {matchedDrivers.length === 0 && matchedVans.length === 0 && matchedStudents.length === 0 && (
            <p className="text-body-md text-on-surface-variant">No results for "{query}".</p>
          )}
        </div>
      )}
    </Card>
  )
}

function SearchGroup({ title, icon, children }: { title: string; icon: string; children: ReactNode }) {
  const hasContent = Array.isArray(children) ? children.length > 0 : Boolean(children)
  if (!hasContent) return null
  return (
    <div>
      <h3 className="mb-2 flex items-center gap-2 text-title-md text-primary">
        <span className="material-symbols-outlined !text-[20px]">{icon}</span>
        {title}
      </h3>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  )
}
