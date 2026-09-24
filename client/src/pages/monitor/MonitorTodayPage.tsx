import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { getCurrentCoords } from '../../lib/geo'
import { formatDuration } from '../../lib/format'
import { vanName } from '../../lib/fleet'
import { formatWeekdays, isoWeekday } from '../../lib/weekdays'
import { MD_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import { Button } from '../../components/Button'
import { Card, CardHeader, CardTitle } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { CallButton, ConfirmCard, SectionHeader, ThumbBar } from '../../components/mobile'
import { Segmented } from '../../components/Records'
import { StatusBadge } from '../../components/StatusBadge'
import { PageTopBar } from '../../layouts/TopBar'
import { useMonitorHome } from './monitorData'
import { clockTime, shiftName } from '../driver/driverData'
import type { DriverSession, MonitorHome, ShiftPeriod } from '../../types/api'

const SHIFT_TEXT = { morning: 'Mornings', afternoon: 'Afternoons', both: 'Mornings and afternoons' } as const

function defaultShift(home: MonitorHome | undefined): ShiftPeriod {
  if (home?.open_session?.shift_period) return home.open_session.shift_period
  if (home?.assignment?.shift_period === 'morning' || home?.assignment?.shift_period === 'afternoon') return home.assignment.shift_period
  return new Date().getHours() < 12 ? 'morning' : 'afternoon'
}

// Monitor app, Today tab (monitor-role). A monitor rides with one driver: this page shows the
// driver (tap to call), the van, the days and shift they ride, and checking in and out for their
// hours. No student data anywhere: the server never sends any to a monitor.
export function MonitorTodayPage() {
  const queryClient = useQueryClient()
  const wide = useMediaQuery(MD_QUERY)
  const homeQuery = useMonitorHome()
  const home = homeQuery.data
  const [selected, setSelected] = useState<ShiftPeriod | null>(null)
  // Until they pick one, the shift follows the data (the open shift, else the one they ride).
  const shift = selected ?? defaultShift(home)
  const [pendingSwitch, setPendingSwitch] = useState<ShiftPeriod | null>(null)
  const [error, setError] = useState<string | null>(null)

  const open = home?.open_session ?? null
  const isOpenHere = open?.shift_period === shift
  const endedHere = (home?.today_sessions ?? []).some((s) => s.shift_period === shift && s.check_out_at)
  const refresh = () => {
    setError(null)
    queryClient.invalidateQueries({ queryKey: ['monitor-me'] })
    queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }
  const fail = (fallback: string) => (err: unknown) => setError(err instanceof ApiError ? err.message : fallback)

  const checkIn = useMutation({
    mutationFn: async (vars: { shiftPeriod: ShiftPeriod; confirmSwitch?: boolean }) => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>('/sessions/checkin', {
        shift_period: vars.shiftPeriod,
        ...(vars.confirmSwitch ? { confirm_switch: true } : {}),
        ...(coords ? { check_in_lat: coords.lat, check_in_lng: coords.lng } : {}),
      })
    },
    onSuccess: () => {
      setPendingSwitch(null)
      refresh()
    },
    onError: fail('Check-in failed.'),
  })
  const checkOut = useMutation({
    mutationFn: async (id: string) => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>(`/sessions/${id}/checkout`, coords ? { check_out_lat: coords.lat, check_out_lng: coords.lng } : {})
    },
    onSuccess: refresh,
    onError: fail('Check-out failed.'),
  })
  const busy = checkIn.isPending || checkOut.isPending

  function mainAction() {
    if (isOpenHere && open) checkOut.mutate(open.id)
    else if (open) setPendingSwitch(shift)
    else checkIn.mutate({ shiftPeriod: shift })
  }
  const actionLabel = busy
    ? 'Please wait…'
    : isOpenHere
      ? `Check out of ${shiftName(shift).toLowerCase()} shift`
      : endedHere
        ? `${shiftName(shift)} shift done`
        : `Check in to ${shiftName(shift).toLowerCase()} shift`

  if (homeQuery.isLoading) return <p className="px-5 pt-6 text-[14px] text-muted">Loading…</p>
  if (homeQuery.isError || !home) return <p className="px-5 pt-6 text-[14px] text-muted">Couldn't load your day right now.</p>

  const ridesToday = home.assignment ? home.assignment.days_of_week.includes(isoWeekday()) : false
  const minutesToday = home.today_sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)

  const status = open ? (
    <StatusBadge tone="success" label={`Checked in · ${open.shift_period ? shiftName(open.shift_period) : 'Shift'} since ${clockTime(open.check_in_at)}`} />
  ) : (
    <StatusBadge tone="neutral" label="Not checked in" />
  )

  const driverCard = (
    <Card>
      <CardHeader>
        <CardTitle>Your driver</CardTitle>
      </CardHeader>
      {home.driver ? (
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-ink">{home.driver.full_name}</p>
            <p className="text-[13px] text-muted">{home.driver.phone ?? 'No phone on file'}</p>
          </div>
          {home.driver.phone && <CallButton phone={home.driver.phone} primary label={`Call ${home.driver.full_name}`} />}
        </div>
      ) : (
        <EmptyState className="!py-5" icon="person_off" title="No driver yet" body="The office hasn't assigned you to a driver. Ask them to add you." />
      )}
    </Card>
  )

  const vanCard = (
    <Card>
      <CardHeader>
        <CardTitle>Van</CardTitle>
      </CardHeader>
      <div className="px-5 py-4">
        {home.van ? (
          <>
            <p className="text-[15px] font-semibold text-ink">{vanName(home.van)}</p>
            <p className="text-[13px] text-muted">
              {[home.van.license_plate, [home.van.color, home.van.brand, home.van.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}
            </p>
          </>
        ) : (
          <p className="text-[14px] text-muted">No van on your driver's runs yet.</p>
        )}
      </div>
    </Card>
  )

  const scheduleCard = (
    <Card>
      <CardHeader>
        <CardTitle>When you ride</CardTitle>
        {home.assignment && <StatusBadge tone={ridesToday ? 'info' : 'neutral'} label={ridesToday ? 'Riding today' : 'Not today'} />}
      </CardHeader>
      <div className="px-5 py-4">
        {home.assignment ? (
          <>
            <p className="text-[15px] font-semibold text-ink">{formatWeekdays(home.assignment.days_of_week)}</p>
            <p className="text-[13px] text-muted">{SHIFT_TEXT[home.assignment.shift_period]}</p>
          </>
        ) : (
          <p className="text-[14px] text-muted">Not set yet.</p>
        )}
      </div>
    </Card>
  )

  const shiftsCard = (
    <Card>
      <CardHeader>
        <CardTitle>Today's hours</CardTitle>
        <span className="text-[13px] text-muted tabular">{formatDuration(minutesToday)}</span>
      </CardHeader>
      {home.today_sessions.length === 0 ? (
        <p className="px-5 py-4 text-[14px] text-muted">No shifts yet today.</p>
      ) : (
        <ul className="divide-y divide-divider">
          {home.today_sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-5 py-3 text-[14px]">
              <span className="font-medium text-ink">{s.shift_period ? shiftName(s.shift_period) : 'Shift'}</span>
              <span className="text-muted tabular">
                {clockTime(s.check_in_at)} – {s.check_out_at ? clockTime(s.check_out_at) : 'now'}
                {s.duration_minutes !== null ? ` · ${formatDuration(s.duration_minutes)}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )

  const switchDialog = pendingSwitch && open && (
    <ConfirmCard
      title={`Switch to ${shiftName(pendingSwitch).toLowerCase()}?`}
      body={`You're checked into ${open.shift_period ? shiftName(open.shift_period).toLowerCase() : 'another shift'}. Switching checks you out of it first.`}
      confirmLabel="Switch"
      cancelLabel="Cancel"
      busy={checkIn.isPending}
      onCancel={() => setPendingSwitch(null)}
      onConfirm={() => checkIn.mutate({ shiftPeriod: pendingSwitch, confirmSwitch: true })}
    />
  )

  const shiftSwitch = (
    <Segmented
      label="Shift"
      value={shift}
      onChange={setSelected}
      options={[
        { value: 'morning', label: 'Morning' },
        { value: 'afternoon', label: 'Afternoon' },
      ]}
    />
  )

  if (wide) {
    return (
      <div className="flex flex-col gap-5">
        <PageTopBar title="Today" subtitle={status}>
          {shiftSwitch}
          <Button variant={isOpenHere ? 'outline' : 'primary'} disabled={busy || (endedHere && !isOpenHere)} onClick={mainAction}>
            {actionLabel}
          </Button>
        </PageTopBar>
        {error && <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">{error}</p>}
        <div className="grid items-start gap-5 lg:grid-cols-3">
          {driverCard}
          {vanCard}
          {scheduleCard}
        </div>
        <div className="max-w-[560px]">{shiftsCard}</div>
        {switchDialog}
      </div>
    )
  }

  return (
    <>
      <SectionHeader title="Today" aside={status} />
      <div className="flex flex-col gap-3 px-4">
        <div className="self-start">{shiftSwitch}</div>
        {error && <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">{error}</p>}
        {driverCard}
        {vanCard}
        {scheduleCard}
        {shiftsCard}
      </div>
      <ThumbBar>
        <Button size="lg" className="w-full" variant={isOpenHere ? 'outline' : 'primary'} disabled={busy || (endedHere && !isOpenHere)} onClick={mainAction}>
          {actionLabel}
        </Button>
      </ThumbBar>
      {switchDialog}
    </>
  )
}
