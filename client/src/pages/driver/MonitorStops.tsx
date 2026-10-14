import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { AddressText } from '../../components/AddressText'
import { Button } from '../../components/Button'
import { CallButton } from '../../components/mobile'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { clockTime } from './driverData'
import type { MonitorStop, MonitorStopAction, RunMonitor, ShiftPeriod } from '../../types/api'

// What the stop's badge says. Times are the driver's local clock.
export function stopBadge(stop: MonitorStop | null | undefined): { tone: BadgeTone; label: string } | null {
  if (!stop) return null
  switch (stop.status) {
    case 'dropped_off':
      return { tone: 'success', label: `Dropped off ${clockTime(stop.dropped_off_at!)}` }
    case 'picked_up':
      return { tone: 'success', label: `Picked up ${clockTime(stop.picked_up_at!)}` }
    case 'no_show':
      return { tone: 'alert', label: 'No show' }
    case 'late':
      return { tone: 'caution', label: stop.late_reported_by === 'monitor' ? 'Monitor running late' : 'You said running late' }
    default:
      return null
  }
}

// The monitor(s) riding on this run, shown first on the run and drawn unlike any student row
// (blue background, monitor icon, "MONITOR" tag) so nobody mistakes a monitor for a child. The
// driver picks them up at their address before the first student stop. Name, phone (tap to call),
// address (tap to copy). Nothing at all when no monitor rides this run.
//
// With `actions` (today's run): Picked up / No show / Running late, then Dropped off whenever the
// driver likes (usually the end of the run). These never block the run and are not the monitor's
// hours (those are the monitor's own check-in / check-out).
export function MonitorStops({
  monitors,
  period,
  compact = false,
  actions = false,
}: {
  monitors: RunMonitor[]
  period: ShiftPeriod
  compact?: boolean
  actions?: boolean
}) {
  if (monitors.length === 0) return null
  return (
    <section
      aria-label={`Monitor pickup, ${period}`}
      className={compact ? 'border-t border-divider bg-info-bg' : 'overflow-hidden rounded-m border border-info-fg/30 bg-info-bg shadow-card'}
    >
      {monitors.map((m, i) => (
        <MonitorRow key={m.id} monitor={m} period={period} first={i === 0} actions={actions} />
      ))}
    </section>
  )
}

function MonitorRow({ monitor: m, period, first, actions }: { monitor: RunMonitor; period: ShiftPeriod; first: boolean; actions: boolean }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [confirmNoShow, setConfirmNoShow] = useState(false)
  const stop = m.stop ?? null
  const status = stop?.status ?? 'pending'
  const badge = stopBadge(stop)

  const press = useMutation({
    mutationFn: (action: MonitorStopAction) => api.post<MonitorStop>(`/schedule/monitors/${m.id}/status`, { shift_period: period, action }),
    onMutate: () => setError(null),
    onSuccess: () => setConfirmNoShow(false),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save. Try again.'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['schedule-monitors'] }),
  })
  const busy = press.isPending
  const waiting = status === 'pending' || status === 'late'

  return (
    <div className={`flex flex-col gap-2.5 px-3.5 py-3 text-info-fg ${first ? '' : 'border-t border-info-fg/20'}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-info-fg text-info-bg" aria-hidden>
          <span className="material-symbols-outlined !text-[20px]">shield_person</span>
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="flex items-center gap-2 text-[12px] font-semibold">
            <span className="rounded-sm bg-info-fg px-1.5 py-px text-[10px] tracking-wide text-info-bg">MONITOR</span>
            Pick up first
          </span>
          <span className="truncate text-[15px] font-semibold text-ink">{m.full_name}</span>
          <span className="text-[13px] tabular">{m.phone ?? 'No phone on file'}</span>
          {m.address ? <AddressText address={m.address} className="text-[13px] text-info-fg" /> : <span className="text-[13px]">No address on file</span>}
        </span>
        <span className="flex flex-col items-end gap-2">
          {badge && <StatusBadge tone={badge.tone} label={badge.label} />}
          {m.phone && <CallButton phone={m.phone} label={`Call ${m.full_name}`} />}
        </span>
      </div>

      {actions && status !== 'dropped_off' && (
        <div className="flex flex-wrap justify-end gap-2">
          {confirmNoShow ? (
            <>
              <span className="mr-auto self-center text-[13px] text-ink">The office is told right away. You keep going with the students.</span>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmNoShow(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => press.mutate('no_show')}>
                Mark no show
              </Button>
            </>
          ) : (
            <>
              {waiting && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => press.mutate('running_late')}>
                  <span className="material-symbols-outlined !text-[16px]">schedule</span>
                  Running late
                </Button>
              )}
              {waiting && (
                <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmNoShow(true)}>
                  No show
                </Button>
              )}
              {(waiting || status === 'no_show') && (
                <Button size="sm" disabled={busy} onClick={() => press.mutate('picked_up')}>
                  <span className="material-symbols-outlined !text-[16px]">check</span>
                  Picked up
                </Button>
              )}
              {status !== 'no_show' && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => press.mutate('dropped_off')}>
                  Dropped off
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {actions && status === 'late' && stop?.escalate_at && (
        <span className="text-[12px] text-ink-sub">If not picked up by {clockTime(stop.escalate_at)}, the office is told.</span>
      )}
      {error && (
        <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
          {error}
        </p>
      )}
    </div>
  )
}
