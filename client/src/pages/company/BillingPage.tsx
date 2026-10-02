import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Card } from '../../components/Card'
import { PageIntro, StatCard, StatRow } from '../../components/Records'
import { PageTopBar } from '../../layouts/TopBar'
import type { CompanyBilling, CompanyUsage } from '../../types/api'

// Plan labels for GET /companies/me/billing. Only the pilot exists; no payment method,
// invoices or upgrades on purpose (account-settings task 4).
const PLAN_LABEL: Record<CompanyBilling['plan'], string> = {
  pilot: 'Pilot - free through the end of the year',
}

const USAGE: { key: keyof CompanyUsage; label: string }[] = [
  { key: 'students', label: 'Students' },
  { key: 'drivers', label: 'Drivers' },
  { key: 'monitors', label: 'Monitors' },
  { key: 'vans', label: 'Vans' },
  { key: 'schools', label: 'Schools' },
]

// Company admin's Billing page (Settings): the plan and current usage, read only.
export function BillingPage() {
  const billingQuery = useQuery({ queryKey: ['company-billing'], queryFn: () => api.get<CompanyBilling>('/companies/me/billing') })
  const b = billingQuery.data

  return (
    <div className="flex flex-col gap-5">
      <PageTopBar title="Billing" />
      <PageIntro>Your plan and what your company has in SafeTurns today.</PageIntro>
      {billingQuery.isLoading ? (
        <p className="text-[14px] text-muted">Loading…</p>
      ) : billingQuery.isError || !b ? (
        <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
          {billingQuery.error instanceof ApiError ? billingQuery.error.message : 'Could not load billing.'}
        </p>
      ) : (
        <>
          <Card className="flex max-w-[640px] flex-col gap-1 px-5 py-[18px]">
            <span className="text-[13px] text-muted">Plan</span>
            <span className="text-[17px] font-semibold text-ink">{PLAN_LABEL[b.plan] ?? b.plan}</span>
          </Card>
          <StatRow template="repeat(5, minmax(0, 1fr))">
            {USAGE.map((u) => (
              <StatCard key={u.key} label={u.label} value={b.usage[u.key]} />
            ))}
          </StatRow>
        </>
      )}
    </div>
  )
}
