import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../../lib/api'
import { Button } from '../../../components/Button'
import { Field, Input, Select } from '../../../components/Input'
import { Modal } from '../../../components/Modal'
import type { FleetSettings } from '../../../types/api'
import { ODOMETER_CHOICES } from './fleetText'

// Company reminder defaults (asked right after the first van is added, editable any time from the
// Fleet page). Vans with their own reminder timing keep it when these change.
export function FleetSettingsModal({ settings, firstTime, onClose }: { settings: FleetSettings; firstTime?: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [days, setDays] = useState(String(settings.default_remind_days))
  const [miles, setMiles] = useState(String(settings.default_remind_miles))
  const [odo, setOdo] = useState(settings.odometer_reminder_days === null ? '' : String(settings.odometer_reminder_days))
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api.put<FleetSettings>('/fleet/settings', {
        default_remind_days: Number(days),
        default_remind_miles: Number(miles),
        odometer_reminder_days: odo === '' ? null : Number(odo),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save.'),
  })
  const known = ODOMETER_CHOICES.some((c) => String(c.value ?? '') === odo)
  return (
    <Modal title={firstTime ? 'Set up maintenance reminders' : 'Reminder settings'} onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault()
          setError(null)
          save.mutate()
        }}
      >
        <p className="text-[13px] text-muted">
          {firstTime
            ? 'Every van tracks fleet inspection, 7D inspection, oil change and brake change. Choose when you and the van\'s driver are reminded. You can change this for one van, or here later.'
            : 'The defaults for every van. Vans you gave their own timing keep it.'}
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Remind before a date (days)">
            <Input required type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} />
          </Field>
          <Field label="Remind before a mileage target (miles)">
            <Input required type="number" min={0} max={100000} step={50} value={miles} onChange={(e) => setMiles(e.target.value)} />
          </Field>
        </div>
        <Field label="Remind drivers to enter the odometer">
          <Select value={odo} onChange={(e) => setOdo(e.target.value)}>
            {ODOMETER_CHOICES.map((c) => (
              <option key={c.label} value={c.value ?? ''}>
                {c.label}
              </option>
            ))}
            {!known && <option value={odo}>Every {odo} days</option>}
          </Select>
        </Field>
        {error && (
          <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            {firstTime ? 'Later' : 'Cancel'}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
