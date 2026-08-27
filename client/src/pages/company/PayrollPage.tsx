import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatMoney, formatDuration } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { CsvImportExport } from '../../components/CsvImportExport'
import type { CsvColumn } from '../../lib/csv'
import type { DriverSession, PayAdjustment, PayRule, PublicUser, RateType, UnpaidPaySummary } from '../../types/api'

interface PayrollCsvRow {
  driver: PublicUser
  rule: PayRule | null
}

const CSV_COLUMNS: CsvColumn<PayrollCsvRow>[] = [
  { key: 'email', header: 'Driver Email', value: (r) => r.driver.email },
  { key: 'name', header: 'Driver Name', value: (r) => r.driver.full_name },
  { key: 'rate_type', header: 'Rate Type', value: (r) => r.rule?.rate_type ?? '' },
  { key: 'rate_dollars', header: 'Rate (Dollars)', value: (r) => (r.rule ? (r.rule.rate_cents / 100).toFixed(2) : '') },
]

// Company Admin — Payroll management (§7.2 frontend gap). Set/update each driver's pay rate,
// log one-off adjustments, and — added 2026-08-27 — see what's owed since they were last
// paid and settle it. Driver work-time tracking already existed (sessions.check_in_at/
// check_out_at); this reuses that via the new GET /payroll/unpaid-summary/:driverId rather
// than tracking anything new. Dollar inputs are converted to integer cents at the boundary.
export function PayrollPage() {
  const queryClient = useQueryClient()
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const rulesQuery = useQuery({ queryKey: ['payroll-rules'], queryFn: () => api.get<PayRule[]>('/payroll/rules') })

  const rulesByDriver = useMemo(
    () => new Map((rulesQuery.data ?? []).map((r) => [r.driver_id, r])),
    [rulesQuery.data],
  )

  const payrollCsvRows: PayrollCsvRow[] = useMemo(
    () => (driversQuery.data ?? []).map((driver) => ({ driver, rule: rulesByDriver.get(driver.id) ?? null })),
    [driversQuery.data, rulesByDriver],
  )

  // CSV import (2026-08-28): matched by driver email, per the task's rule. Reuses
  // PUT /payroll/rules/:driverId, which is already upsert-by-design (ON CONFLICT DO UPDATE)
  // — no separate create/update branching needed here, unlike Drivers/Fleet/Students.
  async function handleImportRow(row: Record<string, string>) {
    const email = row['Driver Email']?.trim()
    if (!email) return { ok: false, message: 'Driver Email is required' }
    const driver = (driversQuery.data ?? []).find((d) => d.email.toLowerCase() === email.toLowerCase())
    if (!driver) return { ok: false, message: `No driver found with email ${email}` }
    const rateTypeInput = row['Rate Type']?.trim().toLowerCase()
    if (rateTypeInput !== 'hourly' && rateTypeInput !== 'daily') return { ok: false, message: 'Rate Type must be "hourly" or "daily"' }
    const rateDollarsInput = row['Rate (Dollars)']?.trim()
    const dollars = Number(rateDollarsInput)
    if (!rateDollarsInput || Number.isNaN(dollars) || dollars < 0) return { ok: false, message: 'Rate (Dollars) must be a non-negative number' }
    try {
      await api.put(`/payroll/rules/${driver.id}`, { rate_type: rateTypeInput, rate_cents: Math.round(dollars * 100) })
      return { ok: true, message: 'Rate set' }
    } catch (err) {
      return { ok: false, message: err instanceof ApiError ? err.message : 'Import failed' }
    }
  }

  const [rateDriverId, setRateDriverId] = useState('')
  const [rateType, setRateType] = useState<RateType>('hourly')
  const [rateDollars, setRateDollars] = useState('')
  const [rateMsg, setRateMsg] = useState<string | null>(null)
  const [rateError, setRateError] = useState<string | null>(null)

  const setRule = useMutation({
    mutationFn: () =>
      api.put<PayRule>(`/payroll/rules/${rateDriverId}`, {
        rate_type: rateType,
        rate_cents: Math.round(Number(rateDollars) * 100),
      }),
    onSuccess: (rule) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-rules'] })
      queryClient.invalidateQueries({ queryKey: ['payroll-summary', rule.driver_id] })
      queryClient.invalidateQueries({ queryKey: ['payroll-unpaid-summary', rule.driver_id] })
      setRateMsg('Rate saved.')
      setRateDollars('')
    },
    onError: (err) => setRateError(err instanceof ApiError ? err.message : 'Could not save rate.'),
  })

  function handleSetRule(e: FormEvent) {
    e.preventDefault()
    setRateMsg(null)
    setRateError(null)
    setRule.mutate()
  }

  const [adjDriverId, setAdjDriverId] = useState('')
  const [adjDollars, setAdjDollars] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const [adjDate, setAdjDate] = useState('')
  const [adjMsg, setAdjMsg] = useState<string | null>(null)
  const [adjError, setAdjError] = useState<string | null>(null)

  const addAdjustment = useMutation({
    mutationFn: () =>
      api.post('/payroll/adjustments', {
        driver_id: adjDriverId,
        amount_cents: Math.round(Number(adjDollars) * 100),
        note: adjNote,
        work_date: adjDate,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-summary', adjDriverId] })
      queryClient.invalidateQueries({ queryKey: ['payroll-unpaid-summary', adjDriverId] })
      setAdjMsg('Adjustment recorded.')
      setAdjDollars('')
      setAdjNote('')
      setAdjDate('')
    },
    onError: (err) => setAdjError(err instanceof ApiError ? err.message : 'Could not record adjustment.'),
  })

  function handleAddAdjustment(e: FormEvent) {
    e.preventDefault()
    setAdjMsg(null)
    setAdjError(null)
    addAdjustment.mutate()
  }

  const [detailDriver, setDetailDriver] = useState<PublicUser | null>(null)

  const selectClass =
    'h-14 w-full rounded-lg border border-outline bg-surface-container-lowest px-4 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-headline-lg text-primary">Payroll</h1>
        <CsvImportExport
          entityName="Payroll"
          columns={CSV_COLUMNS}
          rows={payrollCsvRows}
          onImportRow={handleImportRow}
          onImportComplete={() => queryClient.invalidateQueries({ queryKey: ['payroll-rules'] })}
        />
      </div>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Driver Pay Rates</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  {['Driver', 'Rate Type', 'Rate', 'Worked This Cycle', 'Amount Owed', ''].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(driversQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {driversQuery.isLoading ? 'Loading…' : 'No drivers yet.'}
                    </td>
                  </tr>
                ) : (
                  (driversQuery.data ?? []).map((d) => (
                    <DriverPayRow key={d.id} driver={d} rule={rulesByDriver.get(d.id) ?? null} onViewDetail={() => setDetailDriver(d)} />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="col-span-12 flex flex-col gap-5 lg:col-span-4">
          <Card className="p-5">
            <h2 className="mb-3 text-title-lg text-primary">Set Pay Rate</h2>
            <form className="flex flex-col gap-3" onSubmit={handleSetRule}>
              <select required value={rateDriverId} onChange={(e) => setRateDriverId(e.target.value)} className={selectClass}>
                <option value="">Select a driver…</option>
                {(driversQuery.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
              <select value={rateType} onChange={(e) => setRateType(e.target.value as RateType)} className={selectClass}>
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
              </select>
              <Input
                required
                type="number"
                min="0"
                step="0.01"
                placeholder="Rate in dollars"
                value={rateDollars}
                onChange={(e) => setRateDollars(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={setRule.isPending}>
                {setRule.isPending ? 'Saving…' : 'Save Rate'}
              </Button>
              {rateMsg && <p className="text-body-md text-on-surface-variant">{rateMsg}</p>}
              {rateError && (
                <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
                  {rateError}
                </p>
              )}
            </form>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 text-title-lg text-primary">Add Adjustment</h2>
            <form className="flex flex-col gap-3" onSubmit={handleAddAdjustment}>
              <select required value={adjDriverId} onChange={(e) => setAdjDriverId(e.target.value)} className={selectClass}>
                <option value="">Select a driver…</option>
                {(driversQuery.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </select>
              <Input
                required
                type="number"
                step="0.01"
                placeholder="Amount in dollars (negative to deduct)"
                value={adjDollars}
                onChange={(e) => setAdjDollars(e.target.value)}
              />
              <Input required placeholder="Note" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} />
              <input
                required
                type="date"
                value={adjDate}
                onChange={(e) => setAdjDate(e.target.value)}
                className="h-14 w-full rounded-lg border border-outline bg-surface-container-lowest px-4 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20"
              />
              <Button type="submit" variant="secondary" disabled={addAdjustment.isPending}>
                {addAdjustment.isPending ? 'Saving…' : 'Add Adjustment'}
              </Button>
              {adjMsg && <p className="text-body-md text-on-surface-variant">{adjMsg}</p>}
              {adjError && (
                <p role="alert" className="rounded-lg bg-error-container px-3 py-2 text-body-md text-on-error-container">
                  {adjError}
                </p>
              )}
            </form>
          </Card>
        </div>
      </div>

      {detailDriver && <DriverCycleDetailModal driver={detailDriver} onClose={() => setDetailDriver(null)} />}
    </div>
  )
}

function DriverPayRow({
  driver,
  rule,
  onViewDetail,
}: {
  driver: PublicUser
  rule: PayRule | null
  onViewDetail: () => void
}) {
  const queryClient = useQueryClient()
  const unpaidQuery = useQuery({
    queryKey: ['payroll-unpaid-summary', driver.id],
    queryFn: () => api.get<UnpaidPaySummary>(`/payroll/unpaid-summary/${driver.id}`),
    enabled: Boolean(rule),
    retry: false,
  })

  const markPaid = useMutation({
    mutationFn: () => api.post<PayRule>(`/payroll/rules/${driver.id}/mark-paid`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-unpaid-summary', driver.id] })
      queryClient.invalidateQueries({ queryKey: ['payroll-rules'] })
    },
  })

  const worked = unpaidQuery.data
    ? unpaidQuery.data.rate_type === 'hourly'
      ? formatDuration(unpaidQuery.data.worked_minutes)
      : `${unpaidQuery.data.worked_days} ${unpaidQuery.data.worked_days === 1 ? 'day' : 'days'}`
    : '—'

  return (
    <tr className="hover:bg-surface-container-low">
      <td className="px-6 py-3 text-body-md font-medium">
        {rule ? (
          <button type="button" onClick={onViewDetail} className="text-primary hover:underline">
            {driver.full_name}
          </button>
        ) : (
          driver.full_name
        )}
      </td>
      <td className="px-6 py-3 text-body-md text-on-surface-variant">
        {rule ? (rule.rate_type === 'hourly' ? 'Hourly' : 'Daily') : '—'}
      </td>
      <td className="px-6 py-3 text-data-mono text-secondary">
        {rule ? `${formatMoney(rule.rate_cents)} / ${rule.rate_type === 'hourly' ? 'hr' : 'day'}` : 'Not set'}
      </td>
      <td className="px-6 py-3 text-data-mono text-secondary">{rule ? worked : '—'}</td>
      <td className="px-6 py-3 text-data-mono font-medium">
        {rule && unpaidQuery.data ? formatMoney(unpaidQuery.data.total_pay_cents) : rule ? '…' : '—'}
      </td>
      <td className="px-6 py-3 text-right">
        {rule && (
          <Button
            variant="outline"
            className="h-9 px-4 text-label-md"
            disabled={markPaid.isPending || !unpaidQuery.data || unpaidQuery.data.total_pay_cents === 0}
            onClick={() => markPaid.mutate()}
          >
            {markPaid.isPending ? 'Marking…' : 'Paid'}
          </Button>
        )}
      </td>
    </tr>
  )
}

function DriverCycleDetailModal({ driver, onClose }: { driver: PublicUser; onClose: () => void }) {
  const unpaidQuery = useQuery({
    queryKey: ['payroll-unpaid-summary', driver.id],
    queryFn: () => api.get<UnpaidPaySummary>(`/payroll/unpaid-summary/${driver.id}`),
  })
  const sessionsQuery = useQuery({ queryKey: ['sessions', 'all'], queryFn: () => api.get<DriverSession[]>('/sessions') })
  const adjustmentsQuery = useQuery({
    queryKey: ['payroll-adjustments', driver.id],
    queryFn: () => api.get<PayAdjustment[]>(`/payroll/adjustments/${driver.id}`),
  })

  const paidThroughAt = unpaidQuery.data?.paid_through_at ?? null

  const shifts = useMemo(() => {
    const all = (sessionsQuery.data ?? []).filter((s) => s.user_id === driver.id && s.check_out_at)
    return all
      .filter((s) => !paidThroughAt || new Date(s.check_in_at) >= new Date(paidThroughAt))
      .sort((a, b) => b.check_in_at.localeCompare(a.check_in_at))
  }, [sessionsQuery.data, driver.id, paidThroughAt])

  const adjustments = useMemo(() => {
    const all = adjustmentsQuery.data ?? []
    return all
      .filter((a) => !paidThroughAt || a.work_date >= paidThroughAt.slice(0, 10))
      .sort((a, b) => b.work_date.localeCompare(a.work_date))
  }, [adjustmentsQuery.data, paidThroughAt])

  const loading = unpaidQuery.isLoading || sessionsQuery.isLoading || adjustmentsQuery.isLoading

  return (
    <Modal title={`${driver.full_name} — Current Unpaid Cycle`} onClose={onClose}>
      {loading ? (
        <p className="text-body-md text-on-surface-variant">Loading…</p>
      ) : (
        <>
          <p className="text-body-md text-on-surface-variant">
            {paidThroughAt
              ? `Since last paid on ${new Date(paidThroughAt).toLocaleDateString()}.`
              : 'Since the beginning — this driver has never been marked paid.'}
          </p>

          <div>
            <h3 className="mb-1 text-title-md text-primary">Shifts Worked</h3>
            {shifts.length === 0 ? (
              <p className="text-body-md text-on-surface-variant">No completed shifts in this cycle yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-body-md">
                {shifts.map((s) => (
                  <li key={s.id} className="flex justify-between text-on-surface-variant">
                    <span>{new Date(s.check_in_at).toLocaleDateString()}</span>
                    <span className="text-data-mono">{formatDuration(s.duration_minutes ?? 0)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-1 text-title-md text-primary">Adjustments</h3>
            {adjustments.length === 0 ? (
              <p className="text-body-md text-on-surface-variant">No adjustments in this cycle.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-body-md">
                {adjustments.map((a) => (
                  <li key={a.id} className="flex justify-between text-on-surface-variant">
                    <span>
                      {new Date(a.work_date).toLocaleDateString()} — {a.note}
                    </span>
                    <span className="text-data-mono">{formatMoney(a.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {unpaidQuery.data && (
            <div className="rounded-lg border border-outline-variant bg-surface-container p-3">
              <p className="text-label-md text-secondary uppercase">Total Owed</p>
              <p className="text-title-lg font-bold">{formatMoney(unpaidQuery.data.total_pay_cents)}</p>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
