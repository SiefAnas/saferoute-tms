import { useMemo, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { DriverSession, ShiftPeriod, Trip } from '@/api/types'
import { Card, Divided } from '@/components/Card'
import { ConfirmCard } from '@/components/Dialogs'
import { Icon } from '@/components/Icon'
import { Screen } from '@/components/Screen'
import { ActionError, EmptyState, ErrorState, Loading, messageFor } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Button } from '@/components/Button'
import { Text } from '@/components/Text'
import { formatClock, formatTimeOfDay } from '@/lib/format'
import { getCurrentCoords } from '@/lib/geo'
import { radius, tone, type ToneName } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import {
  homeAddress,
  itemsForShift,
  shiftName,
  tripTypeFor,
  useDriverSessions,
  useStudentDetails,
  useTodaySchedule,
  useTodaysTrips,
} from '@/features/driver/data'
import { buildStops, defaultShift, STATE_LABEL, type Stop } from '@/features/driver/stops'
import { StudentSheet, type SheetTarget } from '@/features/driver/StudentSheet'

// Driver app, Today tab (design 3a). The shift switch only changes what is shown; checking in
// is the thumb bar's job. The thumb bar walks the driver through one stop at a time:
// check in → next stop (No-show / Picked up | Dropped off) → check out.
//
// No business rule is decided here. "Already worked this shift", "check in before logging a
// trip" and "no-show already reported" are all the server's answers, shown as they come back
// (API_CONTRACT.md §7).
export default function TodayScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()

  const { query: sessionsQuery, openSession, endedToday } = useDriverSessions()
  const scheduleQuery = useTodaySchedule()
  const { query: tripsQuery, today: todaysTrips } = useTodaysTrips()

  const items = useMemo(() => scheduleQuery.data ?? [], [scheduleQuery.data])
  const studentIds = useMemo(() => [...new Set(items.map((i) => i.student.id))], [items])
  const details = useStudentDetails(studentIds)

  const [selected, setSelected] = useState<ShiftPeriod | null>(null)
  const [pendingSwitch, setPendingSwitch] = useState<ShiftPeriod | null>(null)
  const [confirmEarlyOut, setConfirmEarlyOut] = useState(false)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  // Which shift is shown, derived rather than stored: the driver's explicit choice wins,
  // otherwise the shift they are checked into, otherwise the one matching the time of day on
  // their phone. So the screen lands on the open shift as soon as /sessions answers, and falls
  // back to the clock again once they check out.
  const shift: ShiftPeriod = selected ?? defaultShift(openSession?.shift_period)

  const stops = useMemo(() => buildStops(items, shift, todaysTrips), [items, shift, todaysTrips])
  const counts = {
    morning: itemsForShift(items, 'morning').length,
    afternoon: itemsForShift(items, 'afternoon').length,
  }

  const isOpenHere = openSession?.shift_period === shift
  const otherOpen = Boolean(openSession) && !isOpenHere
  const ended = endedToday.get(shift)
  const next = isOpenHere ? stops.find((s) => s.state === 'todo') : undefined
  const handled = stops.filter((s) => s.state !== 'todo').length

  const fail = (fallback: string) => (err: unknown) => setActionError(messageFor(err, fallback))
  const invalidateSessions = () => queryClient.invalidateQueries({ queryKey: ['sessions'] })

  const checkIn = useMutation({
    mutationFn: async (vars: { shiftPeriod: ShiftPeriod; confirmSwitch?: boolean }) => {
      // GPS is optional server-side and must be sent as both numbers or neither, so a denied
      // or unavailable location simply means no coordinates — never a blocked check-in.
      const coords = await getCurrentCoords()
      return api.post<DriverSession>('/sessions/checkin', {
        shift_period: vars.shiftPeriod,
        ...(vars.confirmSwitch ? { confirm_switch: true } : {}),
        ...(coords ? { check_in_lat: coords.lat, check_in_lng: coords.lng } : {}),
      })
    },
    // onSettled, not onSuccess: after ANY outcome (including a timeout or a 5xx where the
    // server may have saved it anyway) reload, so the screen shows what really happened.
    onSettled: invalidateSessions,
    onError: fail('Check-in failed.'),
  })

  const checkOut = useMutation({
    mutationFn: async (id: string) => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>(
        `/sessions/${id}/checkout`,
        coords ? { check_out_lat: coords.lat, check_out_lng: coords.lng } : {},
      )
    },
    onSettled: invalidateSessions,
    onError: fail('Check-out failed.'),
  })

  const logTrip = useMutation({
    mutationFn: (vars: { studentId: string; shiftPeriod: ShiftPeriod }) =>
      api.post<Trip>('/trips', {
        student_id: vars.studentId,
        trip_type: tripTypeFor(vars.shiftPeriod),
        shift_period: vars.shiftPeriod,
      }),
    onSettled: () => {
      // The trip lands 'pending' and the row shows "Awaiting school" until the school confirms
      // it (or the server auto-completes it after 5 minutes). The session's trip_count changes
      // too, hence both keys.
      queryClient.invalidateQueries({ queryKey: ['trips'] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
    },
    onError: fail('Could not log the trip.'),
  })

  // The server notifies the school and the company admins; there is nothing to do locally
  // beyond refreshing the schedule, which carries the no_show_reported flags.
  const markNoShow = useMutation({
    mutationFn: (vars: { assignmentId: string; shiftPeriod: ShiftPeriod }) =>
      api.post<{ reported: boolean }>(`/schedule/${vars.assignmentId}/no-show`, {
        shift_period: vars.shiftPeriod,
      }),
    // Seen live: the API saved the no-show and then answered 500 (its notification email
    // failed, see MOBILE_BACKEND_NEEDS.md). Reloading after any outcome shows the real state.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['schedule-today'] }),
    onError: fail('Could not report the no-show.'),
  })

  function refresh() {
    setActionError(null)
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
    void queryClient.invalidateQueries({ queryKey: ['schedule-today'] })
    void queryClient.invalidateQueries({ queryKey: ['trips'] })
  }

  function requestCheckIn() {
    setActionError(null)
    // Any open shift means this is a switch, and the server needs confirm_switch: true. Asking
    // first matters: switching closes the open shift and the driver cannot go back to it.
    if (openSession) setPendingSwitch(shift)
    else checkIn.mutate({ shiftPeriod: shift })
  }

  const openSheet = (s: Stop) =>
    setSheet({
      studentId: s.item.student.id,
      schoolId: s.item.school.id,
      period: shift,
      time: s.time,
      parentSkipped: s.parentSkipped,
    })

  const refreshing =
    sessionsQuery.isFetching || scheduleQuery.isFetching || tripsQuery.isFetching

  if (sessionsQuery.isLoading || scheduleQuery.isLoading) {
    return (
      <Screen>
        <Loading label="Loading today's shift…" />
      </Screen>
    )
  }

  // A first load that failed has nothing to show, so it gets the full retry state rather than
  // an empty schedule that would look like "no students today".
  const loadError = sessionsQuery.error ?? scheduleQuery.error
  if (loadError && !sessionsQuery.data) {
    return (
      <Screen>
        <View style={{ paddingTop: 16 }}>
          <ErrorState error={loadError} onRetry={refresh} />
        </View>
      </Screen>
    )
  }

  const pill: { toneName: ToneName; label: string } = isOpenHere
    ? { toneName: 'success', label: 'Checked in' }
    : ended
      ? { toneName: 'neutral', label: 'Shift ended' }
      : otherOpen
        ? { toneName: 'caution', label: 'Other shift open' }
        : { toneName: 'neutral', label: 'Not checked in' }

  const clock = isOpenHere
    ? `Since ${formatClock(openSession!.check_in_at)}`
    : ended
      ? `${formatClock(ended.check_in_at)} – ${formatClock(ended.check_out_at!)}`
      : otherOpen && openSession
        ? `${openSession.shift_period ? shiftName(openSession.shift_period) : 'Shift'} since ${formatClock(openSession.check_in_at)}`
        : ''

  const noun = shift === 'morning' ? 'pickups' : 'drop-offs'
  const pct = stops.length ? Math.round((handled / stops.length) * 100) : 0
  const busy = checkIn.isPending || checkOut.isPending

  return (
    <>
      <Screen
        refreshing={refreshing}
        onRefresh={refresh}
        thumbBar={
          <>
            {actionError ? <ActionError message={actionError} /> : null}
            {isOpenHere && next ? (
              <NextStopActions
                stop={next}
                shift={shift}
                subtitle={
                  shift === 'morning'
                    ? (homeAddress(details.get(next.item.student.id))?.line1 ?? next.item.school.name)
                    : next.item.school.name
                }
                busyTrip={logTrip.isPending}
                busyNoShow={markNoShow.isPending}
                onOpenSheet={() => openSheet(next)}
                onNoShow={() => {
                  setActionError(null)
                  markNoShow.mutate({ assignmentId: next.item.assignment_id, shiftPeriod: shift })
                }}
                onLogTrip={() => {
                  setActionError(null)
                  logTrip.mutate({ studentId: next.item.student.id, shiftPeriod: shift })
                }}
              />
            ) : isOpenHere ? (
              <>
                <Text size={13} color={colors.muted} style={{ textAlign: 'center' }}>
                  {stops.length ? 'Everyone on this shift is handled.' : 'No students on this shift.'}
                </Text>
                <Button
                  label={`Check out of ${shift} shift`}
                  icon="logout"
                  variant="outline"
                  busy={checkOut.isPending}
                  disabled={busy}
                  onPress={() => checkOut.mutate(openSession!.id)}
                />
              </>
            ) : ended ? (
              <Text size={13} color={colors.muted} style={{ textAlign: 'center', paddingVertical: 8 }}>
                This shift has ended. View only.
              </Text>
            ) : (
              <>
                <Button
                  label={`Check in to ${shift} shift`}
                  icon="login"
                  busy={checkIn.isPending}
                  disabled={busy}
                  onPress={requestCheckIn}
                />
                <Text size={12} color={colors.muted} style={{ textAlign: 'center' }}>
                  Your location is saved with check-in
                </Text>
              </>
            )}
          </>
        }
      >
        <View style={{ gap: 14, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 }}>
          <ShiftSwitch selected={shift} counts={counts} onSelect={setSelected} />

          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <StatusBadge label={pill.label} toneName={pill.toneName} />
              {clock ? (
                <Text size={13} weight="medium" tabular>
                  {clock}
                </Text>
              ) : null}
            </View>
            <Text size={13} color={colors.muted}>
              {handled} of {stops.length} {noun} handled
            </Text>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: pct }}
              style={{ height: 4, borderRadius: 2, backgroundColor: colors.track, overflow: 'hidden' }}
            >
              <View style={{ height: '100%', width: `${pct}%`, backgroundColor: colors.progress }} />
            </View>
          </View>
        </View>

        {/* A shift opened before the morning/afternoon split has no shift_period, so it can
            never match the selected shift and would otherwise be impossible to close. */}
        {openSession && !openSession.shift_period ? (
          <View
            style={{
              gap: 8,
              marginHorizontal: 16,
              marginBottom: 12,
              padding: 12,
              borderRadius: radius.card,
              backgroundColor: colors.cautionBg,
            }}
          >
            <Text size={13} color={colors.cautionFg} style={{ lineHeight: 19 }}>
              You have an open shift from before shifts were split into Morning and Afternoon
              (checked in {formatClock(openSession.check_in_at)}). Check out to end it, or check into a
              shift to end it and switch.
            </Text>
            <Button
              label="Check out of old shift"
              variant="outline"
              busy={checkOut.isPending}
              disabled={busy}
              onPress={() => checkOut.mutate(openSession.id)}
            />
          </View>
        ) : null}

        {stops.length === 0 ? (
          <EmptyState
            icon="route"
            title={`No ${shift} students today`}
            body={
              counts[shift === 'morning' ? 'afternoon' : 'morning'] > 0
                ? `You have students on the ${shift === 'morning' ? 'afternoon' : 'morning'} shift.`
                : 'Nobody is assigned to you today. The office sets this up on Assignments.'
            }
          />
        ) : (
          <>
            <Card style={{ marginHorizontal: 16 }}>
              {stops.map((s, i) => (
                <StopRow
                  key={s.item.assignment_id}
                  stop={s}
                  index={i}
                  isNext={next === s}
                  shift={shift}
                  homeLine={homeAddress(details.get(s.item.student.id))?.line1 ?? null}
                  hasNotes={Boolean(details.get(s.item.student.id)?.notes)}
                  onPress={() => openSheet(s)}
                />
              ))}
            </Card>
            <Text size={12} color={colors.faint} style={{ marginHorizontal: 20, marginTop: 10 }}>
              Tap a student for address, parents and notes.
            </Text>
          </>
        )}

        {/* Checking out with stops left is not in the design's thumb bar, but a driver must
            always be able to end their shift — a van breaks down, a route gets reassigned. */}
        {isOpenHere && next ? (
          <View style={{ marginHorizontal: 16, marginTop: 20 }}>
            <Button
              label={`Check out of ${shift} shift early`}
              variant="outline"
              busy={checkOut.isPending}
              disabled={busy}
              onPress={() => setConfirmEarlyOut(true)}
            />
          </View>
        ) : null}
      </Screen>

      {confirmEarlyOut && openSession ? (
        <ConfirmCard
          title={`Check out of ${shift} shift?`}
          body={`${stops.filter((s) => s.state === 'todo').length} ${
            stops.filter((s) => s.state === 'todo').length === 1 ? 'student is' : 'students are'
          } not handled yet. Once you check out you can't come back to this shift today.`}
          cancelLabel="Stay checked in"
          confirmLabel="Check out"
          busy={checkOut.isPending}
          onCancel={() => setConfirmEarlyOut(false)}
          onConfirm={() => {
            checkOut.mutate(openSession.id)
            setConfirmEarlyOut(false)
          }}
        />
      ) : null}

      {pendingSwitch ? (
        <ConfirmCard
          title={`Switch to ${shiftName(pendingSwitch)}?`}
          body={`${
            openSession?.shift_period
              ? `You're checked into ${shiftName(openSession.shift_period)}.`
              : "You're checked into a shift that started before the update."
          } Checking into ${shiftName(pendingSwitch)} checks you out of it, and you won't be able to go back.`}
          confirmLabel="Switch shifts"
          busy={checkIn.isPending}
          onCancel={() => setPendingSwitch(null)}
          onConfirm={() => {
            checkIn.mutate({ shiftPeriod: pendingSwitch, confirmSwitch: true })
            setPendingSwitch(null)
          }}
        />
      ) : null}

      {sheet ? <StudentSheet target={sheet} onClose={() => setSheet(null)} /> : null}
    </>
  )
}

// Segmented control, 2 columns, with a count chip per shift (design 3a). Viewing only.
function ShiftSwitch({
  selected,
  counts,
  onSelect,
}: {
  selected: ShiftPeriod
  counts: Record<ShiftPeriod, number>
  onSelect: (p: ShiftPeriod) => void
}) {
  const colors = useColors()
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        gap: 3,
        padding: 3,
        borderRadius: radius.card,
        backgroundColor: colors.segTrack,
      }}
    >
      {(['morning', 'afternoon'] as const).map((p) => {
        const active = selected === p
        return (
          <Pressable
            key={p}
            onPress={() => onSelect(p)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${shiftName(p)} shift, ${counts[p]} students`}
            style={{
              flex: 1,
              height: 38,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: radius.row,
              backgroundColor: active ? colors.segOn : 'transparent',
            }}
          >
            <Icon
              name={p === 'morning' ? 'wb-twilight' : 'wb-sunny'}
              size={18}
              color={active ? colors.ink : colors.muted}
            />
            <Text size={14} weight="medium" color={active ? colors.ink : colors.muted}>
              {shiftName(p)}
            </Text>
            <View
              style={{
                minWidth: 20,
                height: 20,
                borderRadius: 10,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 4,
                backgroundColor: colors.surface2,
              }}
            >
              <Text size={12} weight="semibold" color={active ? colors.ink : colors.muted}>
                {counts[p]}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

function StopRow({
  stop,
  index,
  isNext,
  shift,
  homeLine,
  hasNotes,
  onPress,
}: {
  stop: Stop
  index: number
  isNext: boolean
  shift: ShiftPeriod
  homeLine: string | null
  hasNotes: boolean
  onPress: () => void
}) {
  const colors = useColors()
  const toneName: ToneName = isNext
    ? 'next'
    : stop.state === 'todo'
      ? 'neutral'
      : STATE_LABEL[stop.state].toneName
  const t = tone(colors, toneName)
  const done = stop.state === 'awaiting' || stop.state === 'confirmed'
  const lead = done ? '✓' : stop.state === 'noshow' ? '✕' : String(index + 1)
  const sub = [
    shift === 'morning' ? (homeLine ?? stop.item.school.name) : stop.item.school.name,
    stop.item.student.grade ? `Grade ${stop.item.student.grade}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Divided first={index === 0}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${stop.item.student.name}. ${
          isNext ? 'Up next. ' : stop.state === 'todo' ? '' : `${STATE_LABEL[stop.state].label}. `
        }Open details.`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          backgroundColor: pressed ? colors.surface2 : 'transparent',
          // Skipped and absent rows sit back at 60%, as in the design.
          opacity: stop.state === 'skipped' || stop.state === 'noshow' ? 0.6 : 1,
        })}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: t.bg,
          }}
        >
          <Text size={12} weight="semibold" color={t.fg}>
            {lead}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Text size={14} weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
              {stop.item.student.name}
            </Text>
            {hasNotes ? <Icon name="sticky-note-2" size={15} color={colors.noteIcon} /> : null}
          </View>
          <Text size={12} color={colors.muted} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text
            size={12}
            tabular
            weight={stop.timeChanged ? 'semibold' : 'regular'}
            color={stop.timeChanged ? colors.cautionFg : colors.muted}
          >
            {stop.time ? formatTimeOfDay(stop.time) : '—'}
          </Text>
          {isNext || stop.state !== 'todo' ? (
            <StatusBadge
              toneName={toneName}
              label={isNext ? 'Up next' : STATE_LABEL[stop.state as Exclude<Stop['state'], 'todo'>].label}
            />
          ) : null}
        </View>
      </Pressable>
    </Divided>
  )
}

// Thumb bar, checked-in state: the next stop, then No-show (1fr) and Picked up / Dropped off
// (2fr), exactly the grid in the design.
function NextStopActions({
  stop,
  shift,
  subtitle,
  busyTrip,
  busyNoShow,
  onOpenSheet,
  onNoShow,
  onLogTrip,
}: {
  stop: Stop
  shift: ShiftPeriod
  subtitle: string
  busyTrip: boolean
  busyNoShow: boolean
  onOpenSheet: () => void
  onNoShow: () => void
  onLogTrip: () => void
}) {
  const colors = useColors()
  return (
    <>
      <Pressable
        onPress={onOpenSheet}
        accessibilityRole="button"
        accessibilityLabel={`Next ${shift === 'morning' ? 'pickup' : 'drop-off'}: ${stop.item.student.name}. Open details.`}
        style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}
      >
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text size={12} color={colors.muted}>
            Next {shift === 'morning' ? 'pickup' : 'drop-off'}
            {stop.time ? ` · ${formatTimeOfDay(stop.time)}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text size={16} weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {stop.item.student.name}
            </Text>
            <Icon name="info" size={18} color={colors.muted} />
          </View>
        </View>
        <Text size={12} color={colors.muted} numberOfLines={2} style={{ maxWidth: '45%', textAlign: 'right' }}>
          {subtitle}
        </Text>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          label="No-show"
          variant="danger"
          busy={busyNoShow}
          busyLabel="Reporting…"
          disabled={busyTrip}
          onPress={onNoShow}
          accessibilityHint="Reports that nobody came out for this stop. The school and the office are told."
          style={{ flex: 1 }}
        />
        <Button
          label={shift === 'morning' ? 'Picked up' : 'Dropped off'}
          icon="check"
          busy={busyTrip}
          busyLabel="Saving…"
          disabled={busyNoShow}
          onPress={onLogTrip}
          style={{ flex: 2 }}
        />
      </View>
    </>
  )
}
