import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { isToday, formatDuration, formatMoney } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { StatusBadge } from '../../components/StatusBadge'
import type { DriverSession, PaySummary, PayRule, PublicUser, Van } from '../../types/api'

// Company Admin Dashboard (§7.2). Ported from the Stitch "Admin Dispatcher Dashboard"
// mockup's visual language (sidebar shell, table + side cards), but scoped to what the
// real API backs. Intentionally NOT included: the mockup's live map, fleet-health %,
// "recent alerts" (speeding/maintenance), and on-duty-support avatars — none of that data
// exists yet (no GPS live-tracking beyond check-in/out points, no VanMaintenance table in
// MVP, no incident/alerts system, no dispatcher-team concept). Faking those would misrepresent
// what the product currently does.
export function CompanyAdminDashboard() {
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(id)
  }, [])

  const driversQuery = useQuery({
    queryKey: ['users', 'driver'],
    queryFn: () => api.get<PublicUser[]>('/users?role=driver'),
  })
  const sessionsQuery = useQuery({
    queryKey: ['sessions', 'all'],
    // company_admin's read has no owner sub-scope, so this returns every driver's shifts.
    queryFn: () => api.get<DriverSession[]>('/sessions'),
  })
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const rulesQuery = useQuery({ queryKey: ['payroll-rules'], queryFn: () => api.get<PayRule[]>('/payroll/rules') })

  const [selectedDriverId, setSelectedDriverId] = useState('')
  const summaryQuery = useQuery({
    queryKey: ['payroll-summary', selectedDriverId],
    queryFn: () => api.get<PaySummary>(`/payroll/summary/${selectedDriverId}`),
    enabled: Boolean(selectedDriverId),
    retry: false,
  })

  const rulesByDriver = useMemo(
    () => new Map((rulesQuery.data ?? []).map((r) => [r.driver_id, r])),
    [rulesQuery.data],
  )

  const driverRows = useMemo(() => {
    const sessions = sessionsQuery.data ?? []
    return (driversQuery.data ?? []).map((driver) => {
      const mine = sessions.filter((s) => s.user_id === driver.id)
      const open = mine.find((s) => s.check_out_at === null)
      const completedToday = mine
        .filter((s) => s.check_out_at && isToday(s.check_in_at))
        .reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)
      const liveElapsed = open && isToday(open.check_in_at) ? (Date.now() - new Date(open.check_in_at).getTime()) / 60_000 : 0
      return { driver, open, minutesToday: completedToday + Math.max(0, liveElapsed) }
    })
  }, [driversQuery.data, sessionsQuery.data])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Dispatch Overview</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Live Driver Status</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  {['Driver Name', 'Status', 'Hours Today'].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {driverRows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {driversQuery.isLoading ? 'Loading…' : 'No drivers yet.'}
                    </td>
                  </tr>
                ) : (
                  driverRows.map(({ driver, open, minutesToday }) => (
                    <tr key={driver.id} className="hover:bg-surface-container-low">
                      <td className="px-6 py-3 text-body-md font-medium">{driver.full_name}</td>
                      <td className="px-6 py-3">
                        {open ? (
                          <StatusBadge tone="success" label="Checked In" pulse />
                        ) : (
                          <StatusBadge tone="neutral" label="Checked Out" />
                        )}
                      </td>
                      <td className="px-6 py-3 text-data-mono text-secondary">{formatDuration(minutesToday)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="col-span-12 flex flex-col gap-5 lg:col-span-4">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-title-lg text-primary">Fleet</h2>
              <span className="material-symbols-outlined text-secondary">local_shipping</span>
            </div>
            {vansQuery.data && vansQuery.data.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {vansQuery.data.map((van) => (
                  <li key={van.id} className="flex justify-between text-body-md">
                    <span className="text-data-mono">{van.license_plate}</span>
                    <span className="text-on-surface-variant">{van.model ?? '—'}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-body-md text-on-surface-variant">No vans yet.</p>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-title-lg text-primary">Payroll Summary</h2>
              <span className="material-symbols-outlined text-secondary">payments</span>
            </div>
            <select
              value={selectedDriverId}
              onChange={(e) => setSelectedDriverId(e.target.value)}
              className="mb-3 h-11 w-full rounded-lg border border-outline-variant bg-surface-container px-3 text-body-md outline-none focus:border-primary-container"
            >
              <option value="">Select a driver…</option>
              {(driversQuery.data ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>

            {!selectedDriverId ? null : summaryQuery.isLoading ? (
              <p className="text-body-md text-on-surface-variant">Loading…</p>
            ) : summaryQuery.isError ? (
              <p className="text-body-md text-on-surface-variant">
                {summaryQuery.error instanceof ApiError && summaryQuery.error.status === 404
                  ? 'No pay rate set for this driver yet.'
                  : 'Could not load summary.'}
              </p>
            ) : summaryQuery.data ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-outline-variant bg-surface-container p-3">
                  <p className="text-label-md text-secondary uppercase">Rate</p>
                  <p className="text-title-lg font-bold">
                    {formatMoney(summaryQuery.data.rate_cents)} / {summaryQuery.data.rate_type === 'hourly' ? 'hr' : 'day'}
                  </p>
                </div>
                <div className="rounded-lg border border-outline-variant bg-surface-container p-3">
                  <p className="text-label-md text-secondary uppercase">Total Pay</p>
                  <p className="text-title-lg font-bold">{formatMoney(summaryQuery.data.total_pay_cents)}</p>
                </div>
              </div>
            ) : null}
            {!selectedDriverId && rulesByDriver.size === 0 && (
              <p className="text-body-md text-on-surface-variant">No pay rates configured yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
