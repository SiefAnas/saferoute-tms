import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatMoney } from '../../lib/format'
import { Card } from '../../components/Card'
import type { PaySummary, PayRule, PublicUser, Van } from '../../types/api'

// Company Admin Dashboard (§7.2). Ported from the Stitch "Admin Dispatcher Dashboard"
// mockup's visual language, but scoped to what the real API backs. Intentionally NOT
// included: the mockup's live map, fleet-health %, "recent alerts" (speeding/maintenance),
// and on-duty-support avatars — none of that data exists yet.
//
// Driver management (Live Driver Status + Add Driver) and Parent management moved to their
// own pages (nav restructuring, 2026-08-27) — this page is a lighter overview for now. Per
// Anas's explicit instruction, a real "overall status" redesign (driver counts, absent
// students today from pickup_skips + pickup_no_shows, pending confirmations, etc.) is
// intentionally deferred to a follow-up pass rather than guessed at here.
export function CompanyAdminDashboard() {
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
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

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Dispatch Overview</h1>
      <p className="text-body-md text-on-surface-variant">
        Driver and Parent management have moved to their own pages in the sidebar. A fuller overview (driver status,
        absent students, pending confirmations) is coming in a follow-up pass.
      </p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
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
  )
}
