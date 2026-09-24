import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../../lib/api'
import { getCurrentCoords } from '../../lib/geo'
import { formatTimeOfDay, formatWeekdayDate } from '../../lib/format'
import { Button } from '../../components/Button'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { ConfirmCard, ThumbBar } from '../../components/mobile'
import { StudentPanel, StudentSheet, type SheetTarget } from './StudentSheet'
import { LG_QUERY, MD_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import { NameCell, Segmented, StatCard, StatRow, TableCard, TableRow, stop as stopClick } from '../../components/Records'
import { PageTopBar } from '../../layouts/TopBar'
import {
  clockTime,
  homeAddress,
  itemsForShift,
  shiftName,
  tripTypeFor,
  useDriverSessions,
  useStudentDetails,
  useTodaySchedule,
  useTodaysTrips,
} from './driverData'
import type { DriverSession, ShiftPeriod, TodayScheduleItem, Trip } from '../../types/api'

type StopState = 'todo' | 'awaiting' | 'confirmed' | 'noshow' | 'skipped'

interface Stop {
  item: TodayScheduleItem
  state: StopState
  time: string | null // effective time for this shift ("HH:MM:SS"), override applied
  timeChanged: boolean
  parentSkipped: boolean
  trip: Trip | undefined
}

const STATE_LABEL: Record<Exclude<StopState, 'todo'>, { label: string; tone: BadgeTone }> = {
  awaiting: { label: 'Awaiting school', tone: 'caution' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  noshow: { label: 'No-show', tone: 'alert' },
  skipped: { label: 'Parent skipped', tone: 'info' },
}

// Every stop's state on one shift, from real data only: a logged trip (pending → awaiting the
// school, complete → confirmed), a reported no-show, a parent skip or a skip override.
function buildStops(items: TodayScheduleItem[], period: ShiftPeriod, trips: Trip[]): Stop[] {
  return itemsForShift(items, period)
    .map((item) => {
      const usual = period === 'morning' ? item.pickup_time : item.dropoff_time
      const override = period === 'morning' ? item.override?.pickup_time : item.override?.dropoff_time
      const time = override ?? usual
      const mine = trips.filter((t) => t.student_id === item.student.id && t.shift_period === period)
      const trip = mine.find((t) => t.trip_type === tripTypeFor(period)) ?? mine[0]
      const parentSkipped = item.parent_skipped[period]
      let state: StopState = 'todo'
      if (trip) state = trip.status === 'complete' ? 'confirmed' : 'awaiting'
      else if (item.no_show_reported[period]) state = 'noshow'
      else if (parentSkipped || item.override?.skip) state = 'skipped'
      return { item, state, time, timeChanged: Boolean(override) && override !== usual, parentSkipped, trip }
    })
    .sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99') || a.item.student.name.localeCompare(b.item.student.name))
}

function defaultShift(open: DriverSession | undefined): ShiftPeriod {
  if (open?.shift_period) return open.shift_period
  return new Date().getHours() < 12 ? 'morning' : 'afternoon'
}

// Driver app, Today tab (design 3a). The shift switch only changes what's shown; checking in
// is the thumb bar's job. The thumb bar walks the driver through one stop at a time:
// check in → next stop (No-show / Picked up | Dropped off) → check out.
// Wide desktops (lg) show the run list and the selected student's details side by side instead
// of opening the bottom sheet.
export function DriverTodayPage() {
  const queryClient = useQueryClient()
  const sideBySide = useMediaQuery(LG_QUERY)
  const wide = useMediaQuery(MD_QUERY)
  const { query: sessionsQuery, openSession, endedToday } = useDriverSessions()
  const scheduleQuery = useTodaySchedule()
  const { today: todaysTrips } = useTodaysTrips()
  const items = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data])
  const details = useStudentDetails(useMemo(() => [...new Set(items.map((i) => i.student.id))], [items]))

  const [selected, setSelected] = useState<ShiftPeriod | null>(null)
  const shift: ShiftPeriod = selected ?? defaultShift(openSession)
  const [pendingSwitch, setPendingSwitch] = useState<ShiftPeriod | null>(null)
  const [confirmEarlyOut, setConfirmEarlyOut] = useState(false)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // No-show: confirm first, then mark it and stay on this screen with a short "marked" note.
  const [confirmNoShow, setConfirmNoShow] = useState<{ assignmentId: string; name: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  // Once sessions load, land on the shift the driver is checked into.
  useEffect(() => {
    if (selected === null && sessionsQuery.data) setSelected(defaultShift(openSession))
  }, [selected, sessionsQuery.data, openSession])

  const stops = useMemo(() => buildStops(items, shift, todaysTrips), [items, shift, todaysTrips])
  const counts = { morning: itemsForShift(items, 'morning').length, afternoon: itemsForShift(items, 'afternoon').length }

  const isOpenHere = openSession?.shift_period === shift
  const otherOpen = Boolean(openSession) && !isOpenHere
  const ended = endedToday.get(shift)
  const next = isOpenHere ? stops.find((s) => s.state === 'todo') : undefined
  const handled = stops.filter((s) => s.state !== 'todo').length

  const invalidateSessions = () => queryClient.invalidateQueries({ queryKey: ['sessions'] })
  const fail = (fallback: string) => (err: unknown) => setActionError(err instanceof ApiError ? err.message : fallback)

  const checkIn = useMutation({
    mutationFn: async (vars: { shiftPeriod: ShiftPeriod; confirmSwitch?: boolean }) => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>('/sessions/checkin', {
        shift_period: vars.shiftPeriod,
        ...(vars.confirmSwitch ? { confirm_switch: true } : {}),
        ...(coords ? { check_in_lat: coords.lat, check_in_lng: coords.lng } : {}),
      })
    },
    onSuccess: invalidateSessions,
    onError: fail('Check-in failed.'),
  })

  const checkOut = useMutation({
    mutationFn: async (id: string) => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>(`/sessions/${id}/checkout`, coords ? { check_out_lat: coords.lat, check_out_lng: coords.lng } : {})
    },
    onSuccess: invalidateSessions,
    onError: fail('Check-out failed.'),
  })

  const logTrip = useMutation({
    mutationFn: (vars: { studentId: string; shiftPeriod: ShiftPeriod }) =>
      api.post<Trip>('/trips', { student_id: vars.studentId, trip_type: tripTypeFor(vars.shiftPeriod), shift_period: vars.shiftPeriod }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: fail('Could not log the trip.'),
  })

  // Notifies the school + company admin server-side (services/schedule.js markNoShow).
  const markNoShow = useMutation({
    mutationFn: (vars: { assignmentId: string; shiftPeriod: ShiftPeriod; name: string }) =>
      api.post<{ reported: boolean }>(`/schedule/${vars.assignmentId}/no-show`, { shift_period: vars.shiftPeriod }),
    onSuccess: (_res, vars) => setNotice(`${vars.name} marked as no-show`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['schedule-today'] }),
    onError: fail('Could not mark the no-show.'),
  })

  function requestCheckIn() {
    setActionError(null)
    if (openSession) setPendingSwitch(shift)
    else checkIn.mutate({ shiftPeriod: shift })
  }

  const targetOf = (s: Stop): SheetTarget => ({
    studentId: s.item.student.id,
    schoolId: s.item.school.id,
    period: shift,
    time: s.time,
    parentSkipped: s.parentSkipped,
  })
  const openSheet = (s: Stop) => setSheet(targetOf(s))
  // Side by side: the student picked in the list (on this shift), else the next stop, else the first.
  const pickedStop = sheet && sheet.period === shift ? stops.find((s) => s.item.student.id === sheet.studentId) : undefined
  const panelStop = sideBySide ? (pickedStop ?? next ?? stops[0]) : undefined

  if (sessionsQuery.isLoading || scheduleQuery.isLoading) {
    return <p className="px-5 pt-6 text-[14px] text-muted">Loading…</p>
  }

  const pill: { tone: BadgeTone; label: string } = isOpenHere
    ? { tone: 'success', label: 'Checked in' }
    : ended
      ? { tone: 'neutral', label: 'Shift ended' }
      : otherOpen
        ? { tone: 'caution', label: 'Other shift open' }
        : { tone: 'neutral', label: 'Not checked in' }
  const clock = isOpenHere
    ? `Since ${clockTime(openSession!.check_in_at)}`
    : ended
      ? `${clockTime(ended.check_in_at)} – ${clockTime(ended.check_out_at!)}`
      : otherOpen && openSession
        ? `${openSession.shift_period ? shiftName(openSession.shift_period) : 'Shift'} since ${clockTime(openSession.check_in_at)}`
        : ''
  const noun = shift === 'morning' ? 'pickups' : 'drop-offs'
  const pct = stops.length ? Math.round((handled / stops.length) * 100) : 0
  const busy = checkIn.isPending || checkOut.isPending
  // Where this stop goes on this shift: morning = home → school, afternoon = school → home.
  const fromTo = (s: Stop) => {
    const home = homeAddress(details.get(s.item.student.id))?.line1 ?? 'Home'
    return shift === 'morning' ? { from: home, to: s.item.school.name } : { from: s.item.school.name, to: home }
  }

  const dialogs = (
    <>
    {confirmEarlyOut && openSession && (
      <ConfirmCard
        title={`Check out of ${shift} shift?`}
        body={`${stops.filter((s) => s.state === 'todo').length} ${stops.filter((s) => s.state === 'todo').length === 1 ? 'student is' : 'students are'} not handled yet. Once you check out you can't come back to this shift today.`}
        cancelLabel="Stay checked in"
        confirmLabel="Check out"
        busy={checkOut.isPending}
        onCancel={() => setConfirmEarlyOut(false)}
        onConfirm={() => {
          checkOut.mutate(openSession.id)
          setConfirmEarlyOut(false)
        }}
      />
    )}

    {confirmNoShow && (
      <ConfirmCard
        title={`Mark ${confirmNoShow.name} as no-show?`}
        body={`Nobody came out for this ${shift === 'morning' ? 'pickup' : 'drop-off'}. The school and the office are told.`}
        confirmLabel="Mark no-show"
        onCancel={() => setConfirmNoShow(null)}
        onConfirm={() => {
          markNoShow.mutate({ assignmentId: confirmNoShow.assignmentId, shiftPeriod: shift, name: confirmNoShow.name })
          setConfirmNoShow(null)
        }}
      />
    )}

    {pendingSwitch && (
      <ConfirmCard
        title={`Switch to ${shiftName(pendingSwitch)}?`}
        body={
          <>
            {openSession?.shift_period
              ? `You're checked into ${shiftName(openSession.shift_period)}.`
              : "You're checked into a shift that started before the update."}{' '}
            Checking into {shiftName(pendingSwitch)} checks you out of it, and you won&apos;t be able to go back.
          </>
        }
        confirmLabel="Switch shifts"
        busy={checkIn.isPending}
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          checkIn.mutate({ shiftPeriod: pendingSwitch, confirmSwitch: true })
          setPendingSwitch(null)
        }}
      />
    )}

    {sheet && !sideBySide && <StudentSheet target={sheet} onClose={() => setSheet(null)} />}
    </>
  )

  // Desktop (md and up): a website page in the admin style (top bar actions, stat cards, a
  // record table for the run, the student panel beside it on wide screens). Same data, same
  // actions and the same dialogs as the phone layout below.
  if (wide) {
    const runLabel = `${shiftName(shift)} ${shift === 'morning' ? 'pickups' : 'drop-offs'}`
    const template = '44px minmax(180px,1.3fr) minmax(220px,2fr) 90px 150px 220px'
    return (
      <div className="flex flex-col gap-5">
        <PageTopBar title="Today" subtitle={formatWeekdayDate()}>
          <Segmented
            label="Shift"
            value={shift}
            onChange={(p) => setSelected(p)}
            options={(['morning', 'afternoon'] as const).map((p) => ({ value: p, label: `${shiftName(p)} · ${counts[p]}` }))}
          />
          {isOpenHere ? (
            <Button variant="outline" disabled={busy} onClick={() => (next ? setConfirmEarlyOut(true) : checkOut.mutate(openSession!.id))}>
              <span className="material-symbols-outlined !text-[18px]">logout</span>
              {checkOut.isPending ? 'Please wait…' : `Check out of ${shift}`}
            </Button>
          ) : !ended ? (
            <Button disabled={busy} onClick={requestCheckIn}>
              <span className="material-symbols-outlined !text-[18px]">login</span>
              {checkIn.isPending ? 'Please wait…' : `Check in to ${shift}`}
            </Button>
          ) : null}
        </PageTopBar>

        {openSession && !openSession.shift_period && (
          <div className="flex items-center justify-between gap-3 rounded-card bg-caution-bg px-5 py-3 text-[14px] text-caution-fg">
            You have an open shift from before shifts were split (checked in {clockTime(openSession.check_in_at)}).
            <Button variant="outline" size="sm" disabled={busy} onClick={() => checkOut.mutate(openSession.id)}>
              Check out of old shift
            </Button>
          </div>
        )}
        {actionError && (
          <p role="alert" className="rounded-row bg-alert-bg px-4 py-2.5 text-[14px] text-alert-fg">
            {actionError}
          </p>
        )}
        {notice && (
          <p role="status" className="flex items-center gap-2 rounded-row bg-success-bg px-4 py-2.5 text-[14px] font-medium text-success-fg">
            <span className="material-symbols-outlined !text-[18px]">check_circle</span>
            {notice}
          </p>
        )}

        <StatRow template="1fr 1fr 1.4fr">
          <StatCard label={`${shiftName(shift)} shift`} value={pill.label} sub={clock || (ended ? 'View only' : 'Your location is saved with check-in')} tone={isOpenHere ? 'success' : 'default'} />
          <StatCard label={`${noun[0].toUpperCase()}${noun.slice(1)} handled`} value={`${handled} of ${stops.length}`} sub={`${pct}% done`} />
          <StatCard
            label={`Next ${shift === 'morning' ? 'pickup' : 'drop-off'}`}
            value={next ? next.item.student.name : isOpenHere ? 'All handled' : '—'}
            sub={next ? `${next.time ? formatTimeOfDay(next.time) : 'No time set'} · ${fromTo(next).from}` : isOpenHere ? 'Check out when you are done' : 'Check in to start'}
          />
        </StatRow>

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          {stops.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-card bg-surface px-6 py-10 text-center shadow-card">
              <span className="material-symbols-outlined !text-[32px] text-muted">route</span>
              <span className="text-[15px] font-semibold text-ink">No {shift} students today</span>
              <span className="text-[14px] text-muted">
                {counts[shift === 'morning' ? 'afternoon' : 'morning'] > 0
                  ? `You have students on the ${shift === 'morning' ? 'afternoon' : 'morning'} shift.`
                  : 'No runs for you today. The Week tab shows the days you drive.'}
              </span>
            </div>
          ) : (
            <TableCard
              title={runLabel}
              hint="Select a student for address, parents and notes"
              template={template}
              minWidth={900}
              columns={[{ label: '#' }, { label: 'Student' }, { label: 'From → To' }, { label: 'Time' }, { label: 'Status' }, { label: '', align: 'right' }]}
            >
              {stops.map((s, i) => {
                const isNext = next === s
                const tone: BadgeTone = isNext ? 'next' : s.state === 'todo' ? 'neutral' : STATE_LABEL[s.state].tone
                const route = fromTo(s)
                const canAct = isOpenHere && s.state === 'todo'
                return (
                  <TableRow
                    key={s.item.assignment_id}
                    template={template}
                    selected={panelStop === s}
                    onClick={() => openSheet(s)}
                    className={s.state === 'skipped' || s.state === 'noshow' ? 'opacity-60' : ''}
                  >
                    <span className="text-[13px] font-semibold text-muted tabular">{i + 1}</span>
                    <NameCell name={s.item.student.name} sub={s.item.student.grade ? `Grade ${s.item.student.grade}` : s.item.school.name} />
                    <span className="flex min-w-0 items-center gap-1.5 text-[13px]">
                      <span className="truncate text-ink">{route.from}</span>
                      <span className="material-symbols-outlined shrink-0 !text-[16px] text-muted">arrow_forward</span>
                      <span className="truncate text-ink">{route.to}</span>
                    </span>
                    <span className={`text-[13px] tabular ${s.timeChanged ? 'font-semibold text-caution-fg' : 'text-ink-sub'}`}>
                      {s.time ? formatTimeOfDay(s.time) : '—'}
                    </span>
                    <span>
                      {isNext || s.state !== 'todo' ? (
                        <StatusBadge tone={tone} label={isNext ? 'Up next' : STATE_LABEL[s.state as Exclude<StopState, 'todo'>].label} />
                      ) : (
                        <span className="text-[13px] text-muted">To do</span>
                      )}
                    </span>
                    <span className="flex justify-end gap-2" onClick={stopClick}>
                      {canAct && (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={markNoShow.isPending || logTrip.isPending}
                            onClick={() => {
                              setActionError(null)
                              setConfirmNoShow({ assignmentId: s.item.assignment_id, name: s.item.student.name })
                            }}
                          >
                            No-show
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={logTrip.isPending || markNoShow.isPending}
                            onClick={() => {
                              setActionError(null)
                              logTrip.mutate({ studentId: s.item.student.id, shiftPeriod: shift })
                            }}
                          >
                            <span className="material-symbols-outlined !text-[16px]">check</span>
                            {shift === 'morning' ? 'Picked up' : 'Dropped off'}
                          </Button>
                        </>
                      )}
                    </span>
                  </TableRow>
                )
              })}
            </TableCard>
          )}
          {panelStop && (
            <div className="xl:sticky xl:top-0">
              <StudentPanel key={`${panelStop.item.student.id}-${shift}`} target={targetOf(panelStop)} />
            </div>
          )}
        </div>
        {dialogs}
      </div>
    )
  }

  return (
    <>
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start">
      <div className="min-w-0">
      <div className="flex flex-col gap-3.5 px-5 pt-4 pb-3.5">
        <div role="tablist" aria-label="Shift" className="grid grid-cols-2 gap-[3px] rounded-m bg-seg-track p-[3px]">
          {(['morning', 'afternoon'] as const).map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={shift === p}
              onClick={() => setSelected(p)}
              className={`flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-row text-[14px] font-medium transition-colors ${
                shift === p ? 'bg-seg-on text-ink shadow-seg' : 'text-muted'
              }`}
            >
              <span className="material-symbols-outlined !text-[18px]">{p === 'morning' ? 'wb_twilight' : 'wb_sunny'}</span>
              {shiftName(p)}
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-surface-2 px-1 text-[12px] font-semibold">
                {counts[p]}
              </span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <StatusBadge tone={pill.tone} label={pill.label} />
            <span className="text-[13px] font-medium text-ink tabular">{clock}</span>
          </div>
          <span className="text-[13px] text-muted">
            {handled} of {stops.length} {noun} handled
          </span>
          <div className="h-1 overflow-hidden rounded-sm bg-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-progress transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {openSession && !openSession.shift_period && (
        <div className="mx-4 mb-3 flex flex-col gap-2 rounded-m bg-caution-bg p-3 text-[13px] text-caution-fg">
          You have an open shift from before shifts were split into Morning and Afternoon (checked in {clockTime(openSession.check_in_at)}).
          Check out to end it, or check into a shift to end it and switch.
          <Button size="lg" variant="outline" disabled={busy} onClick={() => checkOut.mutate(openSession.id)}>
            {checkOut.isPending ? 'Please wait…' : 'Check out of old shift'}
          </Button>
        </div>
      )}

      {stops.length === 0 ? (
        <div className="mx-4 flex flex-col items-center gap-3 rounded-m border border-line bg-surface px-6 py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-line text-muted">
            <span className="material-symbols-outlined !text-[24px]">route</span>
          </span>
          <span className="text-[15px] font-semibold">No {shift} students today</span>
          <span className="text-[13px] text-muted">
            {counts[shift === 'morning' ? 'afternoon' : 'morning'] > 0
              ? `You have students on the ${shift === 'morning' ? 'afternoon' : 'morning'} shift.`
              : 'No runs for you today. The Week tab shows the days you drive.'}
          </span>
        </div>
      ) : (
        <div className="mx-4 overflow-hidden rounded-m border border-line bg-surface shadow-card">
          {stops.map((s, i) => {
            const isNext = next === s
            const tone: BadgeTone = isNext ? 'next' : s.state === 'todo' ? 'neutral' : STATE_LABEL[s.state].tone
            const done = s.state === 'awaiting' || s.state === 'confirmed'
            const lead = done ? '✓' : s.state === 'noshow' ? '✕' : String(i + 1)
            const student = details.get(s.item.student.id)
            const home = homeAddress(student)
            const sub = [shift === 'morning' ? home?.line1 ?? s.item.school.name : s.item.school.name, s.item.student.grade ? `Grade ${s.item.student.grade}` : null]
              .filter(Boolean)
              .join(' · ')
            return (
              <button
                key={s.item.assignment_id}
                type="button"
                onClick={() => openSheet(s)}
                aria-current={panelStop === s ? 'true' : undefined}
                className={`grid w-full cursor-pointer grid-cols-[26px_1fr_auto] items-center gap-3 px-3.5 py-3 text-left hover:bg-surface-2/60 ${
                  i ? 'border-t border-divider' : ''
                } ${s.state === 'skipped' || s.state === 'noshow' ? 'opacity-60' : ''} ${panelStop === s ? 'bg-row-selected' : ''}`}
              >
                <span
                  className={`flex h-[26px] w-[26px] items-center justify-center rounded-full text-[12px] font-semibold ${
                    {
                      success: 'bg-success-bg text-success-fg',
                      caution: 'bg-caution-bg text-caution-fg',
                      alert: 'bg-alert-bg text-alert-fg',
                      info: 'bg-info-bg text-info-fg',
                      neutral: 'bg-neutral-bg text-neutral-fg',
                      next: 'bg-next-bg text-next-fg',
                    }[tone]
                  }`}
                >
                  {lead}
                </span>
                <span className="flex min-w-0 flex-col gap-px">
                  <span className="flex items-center gap-[5px] text-[14px] font-medium text-ink">
                    <span className="truncate">{s.item.student.name}</span>
                    {student?.notes && (
                      <span className="material-symbols-outlined !text-[15px] text-note-icon" aria-label="Has notes">
                        sticky_note_2
                      </span>
                    )}
                  </span>
                  <span className="truncate text-[12px] text-muted">{sub}</span>
                </span>
                <span className="flex flex-col items-end gap-1">
                  <span className={`text-[12px] tabular ${s.timeChanged ? 'font-semibold text-caution-fg' : 'text-muted'}`}>
                    {s.time ? formatTimeOfDay(s.time) : '—'}
                  </span>
                  {(isNext || s.state !== 'todo') && (
                    <StatusBadge mobile tone={tone} label={isNext ? 'Up next' : STATE_LABEL[s.state as Exclude<StopState, 'todo'>].label} />
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {stops.length > 0 && (
        <span className="mx-5 mt-2.5 block text-[12px] text-faint">
          {sideBySide ? 'Select a student to see their address, parents and notes.' : 'Tap a student for address, parents and notes.'}
        </span>
      )}

      {/* Checking out early (stops still left) isn't in the design's thumb bar, but a driver
          must always be able to end their shift. Kept large per the Check in/Check out rule. */}
      {isOpenHere && next && (
        <div className="mx-4 mt-5">
          <Button size="lg" variant="outline" className="w-full" disabled={busy} onClick={() => setConfirmEarlyOut(true)}>
            {checkOut.isPending ? 'Please wait…' : `Check out of ${shift} shift early`}
          </Button>
        </div>
      )}
      </div>

      {panelStop && (
        <div className="mx-4 mt-4 lg:sticky lg:top-0 lg:ml-2">
          <StudentPanel key={`${panelStop.item.student.id}-${shift}`} target={targetOf(panelStop)} />
        </div>
      )}
      </div>

      <ThumbBar>
        {actionError && (
          <p role="alert" className="rounded-row bg-alert-bg px-3 py-2 text-[13px] text-alert-fg">
            {actionError}
          </p>
        )}
        {notice && (
          <p role="status" className="flex items-center gap-2 rounded-row bg-success-bg px-3 py-2 text-[13px] font-medium text-success-fg">
            <span className="material-symbols-outlined !text-[18px]">check_circle</span>
            {notice}
          </p>
        )}
        {isOpenHere && next ? (
          <>
            <button type="button" onClick={() => openSheet(next)} className="flex cursor-pointer items-end justify-between gap-2.5 text-left">
              <span className="flex min-w-0 flex-col gap-px">
                <span className="text-[12px] text-muted">
                  Next {shift === 'morning' ? 'pickup' : 'drop-off'}
                  {next.time ? ` · ${formatTimeOfDay(next.time)}` : ''}
                </span>
                <span className="flex items-center gap-1 text-[16px] font-semibold text-ink">
                  <span className="truncate">{next.item.student.name}</span>
                  <span className="material-symbols-outlined !text-[18px] text-muted">info</span>
                </span>
              </span>
              <span className="shrink-0 text-right text-[12px] text-muted">
                {shift === 'morning' ? homeAddress(details.get(next.item.student.id))?.line1 ?? next.item.school.name : next.item.school.name}
              </span>
            </button>
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              <Button
                size="lg"
                variant="danger"
                className="font-medium"
                disabled={markNoShow.isPending || logTrip.isPending}
                onClick={() => {
                  setActionError(null)
                  setConfirmNoShow({ assignmentId: next.item.assignment_id, name: next.item.student.name })
                }}
              >
                {markNoShow.isPending ? 'Saving…' : 'No-show'}
              </Button>
              <Button
                size="lg"
                disabled={logTrip.isPending || markNoShow.isPending}
                onClick={() => {
                  setActionError(null)
                  logTrip.mutate({ studentId: next.item.student.id, shiftPeriod: shift })
                }}
              >
                <span className="material-symbols-outlined !text-[20px]">check</span>
                {logTrip.isPending ? 'Saving…' : shift === 'morning' ? 'Picked up' : 'Dropped off'}
              </Button>
            </div>
          </>
        ) : isOpenHere ? (
          <>
            <span className="text-center text-[13px] text-muted">
              {stops.length ? 'Everyone on this shift is handled.' : 'No students on this shift.'}
            </span>
            <Button size="lg" variant="outline" disabled={busy} onClick={() => checkOut.mutate(openSession!.id)}>
              <span className="material-symbols-outlined !text-[20px]">logout</span>
              {checkOut.isPending ? 'Please wait…' : `Check out of ${shift} shift`}
            </Button>
          </>
        ) : ended ? (
          <span className="py-2 text-center text-[13px] text-muted">This shift has ended. View only.</span>
        ) : (
          <>
            <Button size="lg" disabled={busy} onClick={requestCheckIn}>
              <span className="material-symbols-outlined !text-[20px]">login</span>
              {checkIn.isPending ? 'Please wait…' : `Check in to ${shift} shift`}
            </Button>
            <span className="text-center text-[12px] text-muted">Your location is saved with check-in</span>
          </>
        )}
      </ThumbBar>

      {dialogs}
    </>
  )
}
