import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { formatMoney } from '../../lib/format'
import { Card, CardHeader } from '../../components/Card'
import { Button } from '../../components/Button'
import { Input } from '../../components/Input'
import type { PayRule, PublicUser, RateType } from '../../types/api'

// Company Admin — Payroll management (§7.2 frontend gap): set/update each driver's pay
// rate and log one-off adjustments. The dashboard's Payroll Summary card is read-only by
// design (§7.2); this page is where rates/adjustments actually get set. Dollar inputs are
// converted to integer cents at the boundary — the API only ever speaks cents (money.md).
export function PayrollPage() {
  const queryClient = useQueryClient()
  const driversQuery = useQuery({ queryKey: ['users', 'driver'], queryFn: () => api.get<PublicUser[]>('/users?role=driver') })
  const rulesQuery = useQuery({ queryKey: ['payroll-rules'], queryFn: () => api.get<PayRule[]>('/payroll/rules') })

  const rulesByDriver = useMemo(
    () => new Map((rulesQuery.data ?? []).map((r) => [r.driver_id, r])),
    [rulesQuery.data],
  )

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
    onSuccess: (_data, _vars) => {
      queryClient.invalidateQueries({ queryKey: ['payroll-summary', adjDriverId] })
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

  const selectClass =
    'h-14 w-full rounded-lg border border-outline bg-surface-container-lowest px-4 text-body-lg outline-none focus:border-primary-container focus:ring-2 focus:ring-primary-container/20'

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-headline-lg text-primary">Payroll</h1>

      <div className="grid grid-cols-12 gap-5">
        <Card className="col-span-12 flex flex-col overflow-hidden lg:col-span-8">
          <CardHeader>
            <h2 className="text-title-lg text-primary">Driver Pay Rates</h2>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-outline-variant bg-surface-container-low">
                <tr>
                  {['Driver', 'Rate Type', 'Rate'].map((h) => (
                    <th key={h} className="px-6 py-2 text-label-md text-secondary uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant">
                {(driversQuery.data ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-4 text-body-md text-on-surface-variant">
                      {driversQuery.isLoading ? 'Loading…' : 'No drivers yet.'}
                    </td>
                  </tr>
                ) : (
                  (driversQuery.data ?? []).map((d) => {
                    const rule = rulesByDriver.get(d.id)
                    return (
                      <tr key={d.id} className="hover:bg-surface-container-low">
                        <td className="px-6 py-3 text-body-md font-medium">{d.full_name}</td>
                        <td className="px-6 py-3 text-body-md text-on-surface-variant">
                          {rule ? (rule.rate_type === 'hourly' ? 'Hourly' : 'Daily') : '—'}
                        </td>
                        <td className="px-6 py-3 text-data-mono text-secondary">
                          {rule ? `${formatMoney(rule.rate_cents)} / ${rule.rate_type === 'hourly' ? 'hr' : 'day'}` : 'Not set'}
                        </td>
                      </tr>
                    )
                  })
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
    </div>
  )
}
