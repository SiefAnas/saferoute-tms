import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Button } from '../../components/Button'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { Field } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { TimezoneSelect } from '../../components/TimezoneSelect'
import { zoneHint } from '../../lib/timezone'
import type { Company } from '../../types/api'

// Company timezone (company_admin only), on Company profile below the profile form. It decides the
// company's business day on the server (server/src/time/businessDate.js): which day is "today",
// when a parent's skip cutoff passes, and which day payroll counts a shift in. Saving asks first,
// because records already in SafeTurns get grouped into days differently afterwards.
export function CompanyTimezoneCard({ company }: { company: Company }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [zone, setZone] = useState(company.timezone)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  useEffect(() => setZone(company.timezone), [company.timezone])

  const save = useMutation({
    mutationFn: () => api.patch<Company>('/companies/me', { timezone: zone }),
    onSuccess: (c) => {
      queryClient.setQueryData(['company-me'], c)
      setConfirming(false)
      setSaved(true)
    },
    onError: (err) => {
      setConfirming(false)
      setError(err instanceof ApiError ? err.message : 'Could not save the time zone.')
    },
  })

  if (user?.role !== 'company_admin') return null
  const changed = Boolean(zone) && zone !== company.timezone

  return (
    <Card className="max-w-[640px]">
      <CardHeader>
        <CardTitle>Time zone</CardTitle>
      </CardHeader>
      <div className="flex flex-col gap-4 px-6 pb-6">
        <div className="flex flex-col gap-1.5 text-[14px] text-muted">
          <p>Your company's time zone decides:</p>
          <ul className="list-disc pl-6">
            <li>which day is "today" (drivers' runs, absences, the dashboard)</li>
            <li>when a parent can no longer skip a pickup (30 minutes before the pickup time, local time)</li>
            <li>which day payroll counts a shift in, and where pay periods start and end</li>
          </ul>
        </div>
        <Field label="Time zone">
          <TimezoneSelect
            value={zone}
            onChange={(z) => {
              setZone(z)
              setError(null)
              setSaved(false)
            }}
          />
          {zone && <span className="text-[12px] font-normal text-muted">{zoneHint(zone)} now</span>}
        </Field>
        {error && (
          <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
            {error}
          </p>
        )}
        {saved && !changed && <p className="text-[13px] text-success-fg">Time zone saved.</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" disabled={!changed || save.isPending} onClick={() => setZone(company.timezone)}>
            Cancel
          </Button>
          <Button type="button" disabled={!changed || save.isPending} onClick={() => setConfirming(true)}>
            Save time zone
          </Button>
        </div>
      </div>
      {confirming && (
        <Modal title="Change the time zone?" onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-3 text-[14px] text-ink">
            <p>
              From <b className="font-semibold">{company.timezone.replace(/_/g, ' ')}</b> to{' '}
              <b className="font-semibold">{zone.replace(/_/g, ' ')}</b>.
            </p>
            <p>
              This also changes how records already in SafeTurns are grouped by day. A shift checked in late in the evening or after
              midnight can move to a different day, so pay periods, "worked today" and day totals for past dates can change. Nothing
              is deleted.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
              Keep {company.timezone.replace(/_/g, ' ')}
            </Button>
            <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : 'Change time zone'}
            </Button>
          </div>
        </Modal>
      )}
    </Card>
  )
}
