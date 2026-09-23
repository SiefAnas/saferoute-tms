import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatMoney, formatDuration, formatMonthDay, formatCalendarMonthDay, formatRate } from '../../lib/format'
import { isOnOrAfterCycleStart } from '../../lib/payrollCycle'
import { currentAssignmentBy, vanLabel } from '../../lib/fleet'
import { Button } from '../../components/Button'
import { Field, Input, Select } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { Drawer, DrawerSection } from '../../components/Drawer'
import { InlineEmpty, EmptyState } from '../../components/EmptyState'
import { StatusBadge } from '../../components/StatusBadge'
import { HeroStat, NameCell, StatCard, StatRow, TableCard, TableRow, stop } from '../../components/Records'
import { useToast } from '../../components/Toast'
import { useComingSoon } from '../../components/ComingSoon'
import { CsvImportExport } from '../../components/CsvImportExport'
import { PageTopBar } from '../../layouts/TopBar'
import type { CsvColumn } from '../../lib/csv'
import type { Assignment, DriverSession, PayAdjustment, PayRule, PublicUser, RateType, UnpaidPaySummary, Van } from '../../types/api'

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

const TEMPLATE = '2fr 1.2fr 1.2fr 1fr 1.1fr 110px'

function workedLabel(s: UnpaidPaySummary) {
  return s.rate_type === 'hourly' ? formatDuration(s.worked_minutes) : `${s.worked_days} ${s.worked_days === 1 ? 'day' : 'days'}`
}

// Company Admin — Payroll (design 3b). Hero "owed this cycle", a flat drivers table, and a
// right-side breakdown drawer per driver. Everything owed is computed server-side by
// GET /payroll/unpaid-summary/:driverId (current unpaid cycle since paid_through_at); this page
// only adds those up. Dollar inputs are converted to integer cents at the boundary.
export function PayrollPage() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const openComingSoon = useComingSoon()
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const rulesQuery = useQuery({ queryKey: ['payroll-rules'], queryFn: () => api.get<PayRule[]>('/payroll/rules') })
  const vansQuery = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })

  const drivers = useMemo(() => driversQuery.data ?? [], [driversQuery.data])
  const rulesByDriver = useMemo(() => new Map((rulesQuery.data ?? []).map((r) => [r.driver_id, r])), [rulesQuery.data])

  // One unpaid summary per driver with a rate (same query key the drawer uses, so it's cached).
  const withRule = drivers.filter((d) => rulesByDriver.has(d.id))
  const unpaidQueries = useQueries({
    queries: withRule.map((d) => ({
      queryKey: ['payroll-unpaid-summary', d.id],
      queryFn: () => api.get<UnpaidPaySummary>(`/payroll/unpaid-summary/${d.id}`),
      retry: false,
    })),
  })
  const unpaidByDriver = new Map<string, UnpaidPaySummary>()
  withRule.forEach((d, i) => {
    const data = unpaidQueries[i]?.data
    if (data) unpaidByDriver.set(d.id, data)
  })

  const vanByDriver = useMemo(() => {
    const vans = new Map((vansQuery.data ?? []).map((v) => [v.id, v]))
    const current = currentAssignmentBy(assignmentsQuery.data ?? [], 'driver_user_id')
    return (driverId: string) => {
      const a = current.get(driverId)
      const v = a ? vans.get(a.van_id) : undefined
      return v ? vanLabel(v) : 'No van today'
    }
  }, [vansQuery.data, assignmentsQuery.data])

  const owedTotal = [...unpaidByDriver.values()].reduce((sum, s) => sum + s.total_pay_cents, 0)
  const owedCount = [...unpaidByDriver.values()].filter((s) => s.total_pay_cents > 0).length
  const missingRate = drivers.filter((d) => d.is_active && !rulesByDriver.has(d.id))

  const payrollCsvRows: PayrollCsvRow[] = useMemo(
    () => drivers.map((driver) => ({ driver, rule: rulesByDriver.get(driver.id) ?? null })),
    [drivers, rulesByDriver],
  )

  // CSV import (2026-08-28): matched by driver email, per the task's rule. Reuses
  // PUT /payroll/rules/:driverId, which is already upsert-by-design (ON CONFLICT DO UPDATE)
  // — no separate create/update branching needed here, unlike Drivers/Fleet/Students.
  async function handleImportRow(row: Record<string, string>) {
    const email = row['Driver Email']?.trim()
    if (!email) return { ok: false, message: 'Driver Email is required' }
    const driver = drivers.find((d) => d.email.toLowerCase() === email.toLowerCase())
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

  // ---- Set pay rate ----
  const [rateDriverId, setRateDriverId] = useState('')
  const [rateType, setRateType] = useState<RateType>('hourly')
  const [rateDollars, setRateDollars] = useState('')
  const [rateError, setRateError] = useState<string | null>(null)
  const [showRateModal, setShowRateModal] = useState(false)

  function openRateModal(driverId = '') {
    const existing = driverId ? rulesByDriver.get(driverId) : undefined
    setRateDriverId(driverId)
    setRateType(existing?.rate_type ?? 'hourly')
    setRateDollars(existing ? (existing.rate_cents / 100).toFixed(2) : '')
    setRateError(null)
    setShowRateModal(true)
  }

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
      setRateDollars('')
      setShowRateModal(false)
      const name = drivers.find((d) => d.id === rule.driver_id)?.full_name ?? 'Driver'
      toast.show(`${name}'s rate set · ${formatRate(rule.rate_cents, rule.rate_type)}`)
    },
    onError: (err) => setRateError(err instanceof ApiError ? err.message : 'Could not save rate.'),
  })

  function handleSetRule(e: FormEvent) {
    e.preventDefault()
    setRateError(null)
    setRule.mutate()
  }

  // ---- Add adjustment ----
  const [adjDriverId, setAdjDriverId] = useState('')
  const [adjDollars, setAdjDollars] = useState('')
  const [adjNote, setAdjNote] = useState('')
  const [adjDate, setAdjDate] = useState('')
  const [adjError, setAdjError] = useState<string | null>(null)
  const [showAdjModal, setShowAdjModal] = useState(false)

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
      queryClient.invalidateQueries({ queryKey: ['payroll-adjustments', adjDriverId] })
      const name = drivers.find((d) => d.id === adjDriverId)?.full_name ?? 'Driver'
      toast.show(`Adjustment added for ${name} · ${formatMoney(Math.round(Number(adjDollars) * 100))}`)
      setAdjDollars('')
      setAdjNote('')
      setAdjDate('')
      setShowAdjModal(false)
    },
    onError: (err) => setAdjError(err instanceof ApiError ? err.message : 'Could not record adjustment.'),
  })

  function handleAddAdjustment(e: FormEvent) {
    e.preventDefault()
    setAdjError(null)
    addAdjustment.mutate()
  }

  // ---- Mark paid (row button and drawer footer) ----
  const markPaid = useMutation({
    mutationFn: (vars: { driver: PublicUser; owedCents: number }) => api.post<PayRule>(`/payroll/rules/${vars.driver.id}/mark-paid`),
    onSuccess: (_rule, vars) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-unpaid-summary', vars.driver.id] })
      queryClient.invalidateQueries({ queryKey: ['payroll-rules'] })
      toast.show(`${vars.driver.full_name} marked paid · ${formatMoney(vars.owedCents)}`)
    },
  })

  const [detailDriverId, setDetailDriverId] = useState<string | null>(null)
  const detailDriver = drivers.find((d) => d.id === detailDriverId) ?? null

  const loading = driversQuery.isLoading || rulesQuery.isLoading

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Payroll">
        <CsvImportExport
          entityName="Payroll"
          columns={CSV_COLUMNS}
          rows={payrollCsvRows}
          onImportRow={handleImportRow}
          onImportComplete={() => queryClient.invalidateQueries({ queryKey: ['payroll-rules'] })}
        />
        <Button variant="outline" onClick={() => setShowAdjModal(true)}>
          <span className="material-symbols-outlined !text-[18px]">add_card</span>
          Add adjustment
        </Button>
        <Button onClick={() => openRateModal()}>
          <span className="material-symbols-outlined !text-[18px]">payments</span>
          Set pay rate
        </Button>
      </PageTopBar>

      <StatRow template="1.3fr 1fr 1fr">
        <HeroStat
          label="Owed this cycle"
          value={formatMoney(owedTotal)}
          sub={owedCount === 0 ? 'Everyone is paid up' : `${owedCount} ${owedCount === 1 ? 'driver' : 'drivers'} unpaid`}
        />
        {/* V2 (V2_ROADMAP.md): only each driver's last paid_through_at is stored, so a monthly
            "paid" total can't be computed honestly. Coming Soon instead of a number. */}
        <button type="button" className="cursor-pointer text-left" onClick={() => openComingSoon('Payment history')}>
          <StatCard
            label={`Paid in ${new Date().toLocaleDateString(undefined, { month: 'long' })}`}
            value={
              <span className="inline-flex items-center gap-1.5 text-[20px] text-info-fg">
                <span className="material-symbols-outlined !text-[22px]">rocket_launch</span>
                Coming soon
              </span>
            }
            sub="Monthly totals need payment history"
          />
        </button>
        <StatCard
          label="Missing a pay rate"
          value={missingRate.length}
          tone={missingRate.length > 0 ? 'caution' : 'default'}
          sub={missingRate.length > 0 ? missingRate.map((d) => d.full_name).join(', ') : 'Every active driver has a rate'}
        />
      </StatRow>

      <TableCard
        title="Drivers · current cycle"
        hint="Click a driver for the breakdown"
        template={TEMPLATE}
        columns={[
          { label: 'Driver' },
          { label: 'Rate' },
          { label: 'Worked this cycle' },
          { label: 'Owed', align: 'right' },
          { label: 'Status' },
          { label: '' },
        ]}
      >
        {loading ? (
          <p className="border-t border-divider px-5 py-4 text-[14px] text-muted">Loading…</p>
        ) : drivers.length === 0 ? (
          <EmptyState icon="person_add" title="No drivers yet" body="Add drivers on the Drivers page, then set their pay rates here." />
        ) : (
          drivers.map((d) => {
            const rule = rulesByDriver.get(d.id) ?? null
            const unpaid = unpaidByDriver.get(d.id)
            const owed = unpaid?.total_pay_cents ?? 0
            return (
              <TableRow key={d.id} template={TEMPLATE} selected={detailDriverId === d.id} onClick={() => setDetailDriverId(d.id)}>
                <NameCell name={d.full_name} sub={d.is_active ? vanByDriver(d.id) : 'Deactivated'} />
                <span className="font-medium text-ink-sub tabular">{rule ? formatRate(rule.rate_cents, rule.rate_type) : '—'}</span>
                <span className="font-medium text-ink-sub tabular">{rule ? (unpaid ? workedLabel(unpaid) : '…') : '—'}</span>
                <span className="text-right font-bold tabular">{rule ? (unpaid ? formatMoney(owed) : '…') : '—'}</span>
                <span>
                  {!rule ? (
                    <StatusBadge tone="neutral" label="No rate set" />
                  ) : !unpaid ? null : owed !== 0 ? (
                    <StatusBadge tone="caution" label="Owed" />
                  ) : unpaid.paid_through_at ? (
                    <StatusBadge tone="success" label={`Paid ${formatMonthDay(unpaid.paid_through_at)}`} />
                  ) : (
                    <StatusBadge tone="neutral" label="Nothing owed" />
                  )}
                </span>
                <span className="flex justify-end" onClick={stop}>
                  {!rule ? (
                    d.is_active && <Button size="sm" variant="caution" onClick={() => openRateModal(d.id)}>
                      Set rate
                    </Button>
                  ) : owed !== 0 ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={markPaid.isPending && markPaid.variables?.driver.id === d.id}
                      onClick={() => markPaid.mutate({ driver: d, owedCents: owed })}
                    >
                      Mark paid
                    </Button>
                  ) : null}
                </span>
              </TableRow>
            )
          })
        )}
      </TableCard>

      {showRateModal && (
        <Modal title="Set pay rate" onClose={() => setShowRateModal(false)}>
          <form className="flex flex-col gap-3" onSubmit={handleSetRule}>
            <Field label="Driver">
              <Select required value={rateDriverId} onChange={(e) => setRateDriverId(e.target.value)}>
                <option value="">Select a driver…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Paid by">
                <Select value={rateType} onChange={(e) => setRateType(e.target.value as RateType)}>
                  <option value="hourly">Hour</option>
                  <option value="daily">Day</option>
                </Select>
              </Field>
              <Field label="Rate (dollars)">
                <Input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="18.50"
                  value={rateDollars}
                  onChange={(e) => setRateDollars(e.target.value)}
                />
              </Field>
            </div>
            {rateError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {rateError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setShowRateModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={setRule.isPending}>
                {setRule.isPending ? 'Saving…' : 'Save rate'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {showAdjModal && (
        <Modal title="Add adjustment" onClose={() => setShowAdjModal(false)}>
          <form className="flex flex-col gap-3" onSubmit={handleAddAdjustment}>
            <Field label="Driver">
              <Select required value={adjDriverId} onChange={(e) => setAdjDriverId(e.target.value)}>
                <option value="">Select a driver…</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount (dollars, negative to deduct)">
                <Input required type="number" step="0.01" placeholder="25.00" value={adjDollars} onChange={(e) => setAdjDollars(e.target.value)} />
              </Field>
              <Field label="Work date">
                <Input required type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} />
              </Field>
            </div>
            <Field label="Note">
              <Input required placeholder="Overtime, bonus, deduction…" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} />
            </Field>
            {adjError && (
              <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
                {adjError}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" type="button" onClick={() => setShowAdjModal(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={addAdjustment.isPending}>
                {addAdjustment.isPending ? 'Saving…' : 'Add adjustment'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {detailDriver && (
        <BreakdownDrawer
          driver={detailDriver}
          rule={rulesByDriver.get(detailDriver.id) ?? null}
          marking={markPaid.isPending && markPaid.variables?.driver.id === detailDriver.id}
          onMarkPaid={(owedCents) => markPaid.mutate({ driver: detailDriver, owedCents })}
          onSetRate={() => openRateModal(detailDriver.id)}
          onClose={() => setDetailDriverId(null)}
        />
      )}

      {toast.node}
    </div>
  )
}

// Replaces DriverCycleDetailModal: the current unpaid cycle for one driver.
function BreakdownDrawer({
  driver,
  rule,
  marking,
  onMarkPaid,
  onSetRate,
  onClose,
}: {
  driver: PublicUser
  rule: PayRule | null
  marking: boolean
  onMarkPaid: (owedCents: number) => void
  onSetRate: () => void
  onClose: () => void
}) {
  const unpaidQuery = useQuery({
    queryKey: ['payroll-unpaid-summary', driver.id],
    queryFn: () => api.get<UnpaidPaySummary>(`/payroll/unpaid-summary/${driver.id}`),
    enabled: Boolean(rule),
    retry: false,
  })
  const sessionsQuery = useQuery({ queryKey: ['sessions', 'all'], queryFn: () => api.get<DriverSession[]>('/sessions') })
  const adjustmentsQuery = useQuery({
    queryKey: ['payroll-adjustments', driver.id],
    queryFn: () => api.get<PayAdjustment[]>(`/payroll/adjustments/${driver.id}`),
    enabled: Boolean(rule),
  })

  const paidThroughAt = unpaidQuery.data?.paid_through_at ?? null

  const shifts = useMemo(() => {
    const all = (sessionsQuery.data ?? []).filter((s) => s.user_id === driver.id && s.check_out_at)
    return all
      .filter((s) => isOnOrAfterCycleStart(s.check_in_at, paidThroughAt))
      .sort((a, b) => b.check_in_at.localeCompare(a.check_in_at))
  }, [sessionsQuery.data, driver.id, paidThroughAt])

  // BACKLOG bug fix: this used to compare `a.work_date >= paidThroughAt.slice(0, 10)` (a
  // date-string-only compare), so a same-day adjustment still showed under the new cycle
  // even though the server's own timestamp compare had already excluded it from
  // base_pay_cents/adjustments_cents — see lib/payrollCycle.ts + its test.
  const adjustments = useMemo(() => {
    const all = adjustmentsQuery.data ?? []
    return all.filter((a) => isOnOrAfterCycleStart(a.work_date, paidThroughAt)).sort((a, b) => b.work_date.localeCompare(a.work_date))
  }, [adjustmentsQuery.data, paidThroughAt])

  const s = unpaidQuery.data
  const owed = s?.total_pay_cents ?? 0
  const rateStr = rule ? formatRate(rule.rate_cents, rule.rate_type) : 'No rate set'
  const cycleLabel = !rule ? 'Set a rate to start tracking pay' : paidThroughAt ? `Since last paid ${formatMonthDay(paidThroughAt)}` : 'Never marked paid'

  return (
    <Drawer
      eyebrow="CURRENT UNPAID CYCLE"
      title={driver.full_name}
      subtitle={`${cycleLabel} · ${rateStr}`}
      width={420}
      onClose={onClose}
      headerExtra={
        rule && (
          <div className="flex items-baseline justify-between">
            <span className="font-display text-[34px] leading-10 font-extrabold text-amber-soft tabular">{s ? formatMoney(owed) : '…'}</span>
            <span className="text-[13px] text-hero-sub">{s ? `${workedLabel(s)} worked` : ''}</span>
          </div>
        )
      }
      footer={
        !rule ? (
          <Button size="lg" className="w-full" onClick={onSetRate}>
            <span className="material-symbols-outlined !text-[20px]">payments</span>
            Set a pay rate
          </Button>
        ) : s && owed !== 0 ? (
          <Button size="lg" className="w-full font-display font-bold" disabled={marking} onClick={() => onMarkPaid(owed)}>
            {marking ? 'Marking…' : `Mark ${formatMoney(owed)} as paid`}
          </Button>
        ) : s ? (
          <div className="flex h-12 items-center justify-center gap-1.5 rounded-m bg-success-bg text-[15px] font-bold text-success-fg">
            <span className="material-symbols-outlined !text-[20px]">check_circle</span>
            Paid up
          </div>
        ) : null
      }
    >
      {!rule ? (
        <InlineEmpty icon="payments" tone="neutral" text="This driver has no pay rate yet, so nothing is being tracked as owed." />
      ) : unpaidQuery.isLoading || sessionsQuery.isLoading || adjustmentsQuery.isLoading ? (
        <p className="text-[14px] text-muted">Loading…</p>
      ) : (
        <>
          <DrawerSection title="Shifts worked">
            {shifts.length === 0 ? (
              <InlineEmpty icon="event_available" tone="success" text="New cycle started. No completed shifts yet." />
            ) : (
              shifts.map((x) => (
                <div key={x.id} className="flex justify-between border-b border-divider py-2 text-[14px]">
                  <span className="text-ink-sub">
                    {formatMonthDay(x.check_in_at)}
                    {x.shift_period ? ` · ${x.shift_period === 'morning' ? 'Morning' : 'Afternoon'}` : ''}
                  </span>
                  <span className="font-semibold tabular">{formatDuration(x.duration_minutes ?? 0)}</span>
                </div>
              ))
            )}
          </DrawerSection>
          <DrawerSection title="Adjustments">
            {adjustments.length === 0 ? (
              <InlineEmpty icon="add_card" text="No adjustments this cycle." />
            ) : (
              adjustments.map((a) => (
                <div key={a.id} className="flex justify-between gap-3 border-b border-divider py-2 text-[14px]">
                  <span className="min-w-0 text-ink-sub">
                    {formatCalendarMonthDay(a.work_date)} · {a.note}
                  </span>
                  <span className={`font-bold tabular ${a.amount_cents < 0 ? 'text-alert-fg' : 'text-success-fg'}`}>
                    {a.amount_cents > 0 ? '+' : ''}
                    {formatMoney(a.amount_cents)}
                  </span>
                </div>
              ))
            )}
          </DrawerSection>
        </>
      )}
    </Drawer>
  )
}
