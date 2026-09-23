import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { localISODate } from '../../lib/localDate'
import { formatMoney, formatRate } from '../../lib/format'
import { EmptyState } from '../../components/EmptyState'
import { SectionHeader } from '../../components/mobile'
import { useDriverSessions } from './driverData'
import type { PaySummary } from '../../types/api'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Driver app, Pay tab (design 3a): this month's pay so far (GET /payroll/summary/:id for the
// calendar month) and a calendar of the days actually worked (from the driver's own sessions).
export function DriverPayPage() {
  const { user } = useAuth()
  const { sessions } = useDriverSessions()
  const now = new Date()
  const { from, to } = useMemo(() => {
    const d = new Date()
    return {
      from: localISODate(new Date(d.getFullYear(), d.getMonth(), 1)),
      to: localISODate(new Date(d.getFullYear(), d.getMonth() + 1, 1)),
    }
  }, [])
  const payQuery = useQuery({
    queryKey: ['payroll-summary', user?.id, from, to],
    queryFn: () => api.get<PaySummary>(`/payroll/summary/${user!.id}?from=${from}&to=${to}`),
    enabled: Boolean(user?.id),
    retry: false, // a 404 (no pay rule configured) is an expected state, not worth retrying
  })

  const worked = useMemo(() => {
    const days = new Set<string>()
    for (const s of sessions) days.add(localISODate(new Date(s.check_in_at)))
    return days
  }, [sessions])

  const year = now.getFullYear()
  const month = now.getMonth()
  const lead = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayKey = localISODate(now)
  const monthName = now.toLocaleDateString(undefined, { month: 'long' })

  const p = payQuery.data
  const noRate = payQuery.error instanceof ApiError && payQuery.error.status === 404
  const hours = p ? (p.worked_minutes / 60).toFixed(p.worked_minutes % 60 === 0 ? 0 : 2) : ''

  // Wide desktops: the pay card and the calendar sit side by side.
  return (
    <>
      <SectionHeader title="Pay" aside={monthName} />
      <div className="lg:grid lg:grid-cols-2 lg:items-start">
      <div className="mx-4 flex flex-col gap-1 rounded-m border border-line bg-surface p-4 shadow-card">
        {payQuery.isLoading ? (
          <span className="text-[14px] text-muted">Loading…</span>
        ) : noRate ? (
          <EmptyState
            className="!py-4"
            icon="payments"
            title="No pay rate yet"
            body="Your company hasn't set your pay rate. Ask the office to add it."
          />
        ) : p ? (
          <>
            <span className="text-[13px] text-muted">This month so far</span>
            <span className="text-[32px] leading-10 font-semibold tracking-[-0.02em] text-ink tabular">{formatMoney(p.total_pay_cents)}</span>
            <span className="text-[13px] text-muted tabular">
              {p.worked_days} {p.worked_days === 1 ? 'day' : 'days'} · {hours} h at {formatRate(p.rate_cents, p.rate_type)}
              {p.adjustments_cents !== 0 ? ` · ${p.adjustments_cents > 0 ? '+' : ''}${formatMoney(p.adjustments_cents)} adjustments` : ''}
            </span>
          </>
        ) : (
          <span className="text-[14px] text-muted">Couldn't load your pay right now.</span>
        )}
      </div>

      <div className="mx-4 mt-3 flex flex-col gap-2 rounded-m border border-line bg-surface px-4 py-3.5 shadow-card lg:mt-0 lg:max-w-[440px]">
        <span className="text-[13px] font-medium text-ink">Days worked</span>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-faint">
          {WEEKDAYS.map((w, i) => (
            <span key={i}>{w}</span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`b${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1
            const key = localISODate(new Date(year, month, day))
            const cls =
              key === todayKey
                ? 'bg-cal-today text-on-cal-today'
                : worked.has(key)
                  ? 'bg-cal-worked text-on-cal-worked'
                  : 'text-cal-off'
            return (
              <span
                key={key}
                aria-label={`${day}${worked.has(key) ? ', worked' : ''}${key === todayKey ? ', today' : ''}`}
                className={`flex aspect-square items-center justify-center rounded-[6px] text-[12px] font-medium ${cls}`}
              >
                {day}
              </span>
            )
          })}
        </div>
      </div>
      </div>
    </>
  )
}
