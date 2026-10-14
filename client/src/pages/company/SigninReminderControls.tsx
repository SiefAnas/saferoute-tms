import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { Button } from '../../components/Button'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { Input, Select } from '../../components/Input'
import type { SigninReminderDriver, SigninReminderSettings } from '../../types/api'

// Driver sign-in reminder (branch signin-reminder): a push N minutes before the first stop of the
// driver's run, only if they haven't signed in for that run yet, never on a day without a run.
const CHOICES = [15, 20, 30, 40, 45, 60]
const KEY = ['signin-reminders']

export function useSigninReminders() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<SigninReminderSettings>('/signin-reminders') })
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
      {error}
    </p>
  )
}

// Minutes picker: the usual choices plus "Other" (5-240 minutes).
function MinutesPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [other, setOther] = useState(!CHOICES.includes(value))
  const [draft, setDraft] = useState(String(value))
  return (
    <span className="flex items-center gap-2">
      <Select
        aria-label="Minutes before the first stop"
        value={other ? 'other' : String(value)}
        onChange={(e) => {
          if (e.target.value === 'other') setOther(true)
          else {
            setOther(false)
            onChange(Number(e.target.value))
          }
        }}
      >
        {CHOICES.map((m) => (
          <option key={m} value={m}>
            {m} minutes before
          </option>
        ))}
        <option value="other">Other…</option>
      </Select>
      {other && (
        <>
          <Input aria-label="Minutes" type="number" min={5} max={240} className="w-24" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <Button size="sm" variant="outline" onClick={() => onChange(Number(draft))}>
            Save
          </Button>
        </>
      )}
    </span>
  )
}

// Drivers page card: the company default, or off.
export function SigninReminderCard() {
  const queryClient = useQueryClient()
  const q = useSigninReminders()
  const current = q.data?.default_minutes ?? null
  const [minutes, setMinutes] = useState(30)
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (default_minutes: number | null) => api.put<SigninReminderSettings>('/signin-reminders', { default_minutes }),
    onMutate: () => setError(null),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save.'),
  })
  const own = (q.data?.drivers ?? []).filter((d) => d.mode !== 'default').length
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in reminder</CardTitle>
        <span className="text-[13px] text-muted">{current === null ? 'Off' : `${current} min before the first stop`}</span>
      </CardHeader>
      <div className="flex flex-col gap-3 px-5 pb-4">
        <p className="text-[13px] text-muted">
          Drivers get a push before the first stop of each run, only if they have not signed in for it yet. No run that day, no reminder.
          {own ? ` ${own} driver${own === 1 ? ' has' : 's have'} their own setting (open a driver to change it).` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <MinutesPicker key={current ?? 'off'} value={current ?? minutes} onChange={(n) => (current === null ? setMinutes(n) : save.mutate(n))} />
          {current === null ? (
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(minutes)}>
              Turn on
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={save.isPending} onClick={() => save.mutate(null)}>
              Turn off
            </Button>
          )}
        </div>
        <ErrorLine error={error} />
      </div>
    </Card>
  )
}

// Driver drawer: this driver follows the company default, has their own minutes, or none.
export function DriverSigninReminder({ driverId }: { driverId: string }) {
  const queryClient = useQueryClient()
  const q = useSigninReminders()
  const d: SigninReminderDriver | undefined = q.data?.drivers.find((x) => x.id === driverId)
  const def = q.data?.default_minutes ?? null
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (body: { mode: SigninReminderDriver['mode']; minutes?: number }) => api.put(`/signin-reminders/drivers/${driverId}`, body),
    onMutate: () => setError(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save.'),
  })
  if (!d) return null
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-divider pt-4">
      <h3 className="text-[14px] font-semibold text-ink">Sign-in reminder</h3>
      {def === null ? (
        <p className="text-[13px] text-muted">Off for the company. Turn it on from the card on the Drivers page.</p>
      ) : (
        <>
          <Select
            aria-label="Sign-in reminder for this driver"
            value={d.mode}
            onChange={(e) => {
              const mode = e.target.value as SigninReminderDriver['mode']
              save.mutate(mode === 'custom' ? { mode, minutes: d.minutes ?? def } : { mode })
            }}
          >
            <option value="default">Company default ({def} min before)</option>
            <option value="custom">Own timing for this driver</option>
            <option value="off">Off for this driver</option>
          </Select>
          {d.mode === 'custom' && d.minutes !== null && (
            <MinutesPicker key={d.minutes} value={d.minutes} onChange={(n) => save.mutate({ mode: 'custom', minutes: n })} />
          )}
          <p className="text-[12px] text-muted">
            {d.effective_minutes === null ? 'This driver gets no sign-in reminder.' : `Reminded ${d.effective_minutes} minutes before the first stop of each run.`}
          </p>
        </>
      )}
      <ErrorLine error={error} />
    </div>
  )
}
