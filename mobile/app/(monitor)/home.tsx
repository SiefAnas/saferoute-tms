import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { DriverSession, ShiftPeriod } from '@/api/types'
import { Button } from '@/components/Button'
import { CallButton } from '@/components/CallButton'
import { Card, Divided, SectionHeader } from '@/components/Card'
import { ConfirmCard } from '@/components/Dialogs'
import { Icon } from '@/components/Icon'
import { Screen } from '@/components/Screen'
import { ActionError, EmptyState, ErrorState, Loading, messageFor } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Text } from '@/components/Text'
import { shiftName } from '@/features/driver/shift'
import { defaultMonitorShift, ridesToday, SHIFT_TEXT, useMonitorHome } from '@/features/monitor/data'
import { vanName } from '@/lib/fleet'
import { formatClock, formatDuration } from '@/lib/format'
import { getCurrentCoords } from '@/lib/geo'
import { formatWeekdays } from '@/lib/weekdays'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

// Monitor app, Today tab (monitor-role). A monitor rides with one driver: the driver (tap to
// call), the van, the days and shift they ride, and checking in and out for their hours. There
// is no student data here at all; the server never sends a monitor any.
export default function MonitorHomeScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const homeQuery = useMonitorHome()
  const home = homeQuery.data
  const [selected, setSelected] = useState<ShiftPeriod | null>(null)
  // Until they pick one, the shift follows the data (the open shift, else the one they ride).
  const shift = selected ?? defaultMonitorShift(home)
  const [pendingSwitch, setPendingSwitch] = useState<ShiftPeriod | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['monitor-me'] })
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }
  const fail = (fallback: string) => (err: unknown) => setActionError(messageFor(err, fallback))

  const checkIn = useMutation({
    mutationFn: async (vars: { shiftPeriod: ShiftPeriod; confirmSwitch?: boolean }) => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>('/sessions/checkin', {
        shift_period: vars.shiftPeriod,
        ...(vars.confirmSwitch ? { confirm_switch: true } : {}),
        ...(coords ? { check_in_lat: coords.lat, check_in_lng: coords.lng } : {}),
      })
    },
    onMutate: () => setActionError(null),
    onSuccess: () => setPendingSwitch(null),
    onSettled: refresh,
    onError: fail('Check-in failed.'),
  })
  const checkOut = useMutation({
    mutationFn: async (id: string) => {
      const coords = await getCurrentCoords()
      return api.post<DriverSession>(`/sessions/${id}/checkout`, coords ? { check_out_lat: coords.lat, check_out_lng: coords.lng } : {})
    },
    onMutate: () => setActionError(null),
    onSettled: refresh,
    onError: fail('Check-out failed.'),
  })

  if (homeQuery.isLoading) {
    return (
      <Screen>
        <Loading label="Loading your day…" />
      </Screen>
    )
  }
  if (homeQuery.error || !home) {
    return (
      <Screen onRefresh={refresh}>
        <ErrorState error={homeQuery.error} onRetry={refresh} />
      </Screen>
    )
  }

  const open = home.open_session
  const isOpenHere = open?.shift_period === shift
  const endedHere = home.today_sessions.some((s) => s.shift_period === shift && s.check_out_at)
  const busy = checkIn.isPending || checkOut.isPending
  const minutesToday = home.today_sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0)

  function mainAction() {
    if (isOpenHere && open) checkOut.mutate(open.id)
    else if (open) setPendingSwitch(shift)
    else checkIn.mutate({ shiftPeriod: shift })
  }

  const thumbBar = (
    <Button
      label={
        isOpenHere
          ? `Check out of ${shiftName(shift).toLowerCase()} shift`
          : endedHere
            ? `${shiftName(shift)} shift done`
            : `Check in to ${shiftName(shift).toLowerCase()} shift`
      }
      variant={isOpenHere ? 'outline' : 'primary'}
      icon={isOpenHere ? 'logout' : 'login'}
      busy={busy}
      busyLabel="Please wait…"
      disabled={endedHere && !isOpenHere}
      onPress={mainAction}
    />
  )

  return (
    <Screen refreshing={homeQuery.isFetching} onRefresh={refresh} thumbBar={thumbBar}>
      <SectionHeader
        title="Today"
        aside={open ? `Checked in since ${formatClock(open.check_in_at)}` : 'Not checked in'}
      />

      <View style={{ marginHorizontal: 16, gap: 12 }}>
        <ShiftSwitch selected={shift} onSelect={setSelected} />
        {actionError ? <ActionError message={actionError} /> : null}
      </View>

      {home.driver ? (
        <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text size={12} color={colors.muted}>
              Your driver
            </Text>
            <Text size={16} weight="semibold" numberOfLines={1}>
              {home.driver.full_name}
            </Text>
            <Text size={13} color={colors.muted}>
              {home.driver.phone ?? 'No phone on file'}
            </Text>
          </View>
          {home.driver.phone ? <CallButton phone={home.driver.phone} primary label={`Call ${home.driver.full_name}`} /> : null}
        </Card>
      ) : (
        <View style={{ marginTop: 12 }}>
          <EmptyState icon="person-off" title="No driver yet" body="The office hasn't assigned you to a driver. Ask them to add you." />
        </View>
      )}

      <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16, gap: 2 }}>
        <Text size={12} color={colors.muted}>
          Van
        </Text>
        {home.van ? (
          <>
            <Text size={16} weight="semibold">
              {vanName(home.van)}
            </Text>
            <Text size={13} color={colors.muted}>
              {[home.van.license_plate, [home.van.color, home.van.brand, home.van.model].filter(Boolean).join(' ')]
                .filter(Boolean)
                .join(' · ')}
            </Text>
          </>
        ) : (
          <Text size={14} color={colors.muted}>
            {"No van on your driver's runs yet."}
          </Text>
        )}
      </Card>

      <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16, gap: 2 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text size={12} color={colors.muted}>
            When you ride
          </Text>
          {home.assignment ? (
            <StatusBadge label={ridesToday(home) ? 'Riding today' : 'Not today'} toneName={ridesToday(home) ? 'info' : 'neutral'} />
          ) : null}
        </View>
        {home.assignment ? (
          <>
            <Text size={16} weight="semibold">
              {formatWeekdays(home.assignment.days_of_week)}
            </Text>
            <Text size={13} color={colors.muted}>
              {SHIFT_TEXT[home.assignment.shift_period]}
            </Text>
          </>
        ) : (
          <Text size={14} color={colors.muted}>
            Not set yet.
          </Text>
        )}
      </Card>

      <SectionHeader title="Today's hours" aside={formatDuration(minutesToday)} />
      <Card style={{ marginHorizontal: 16 }}>
        {home.today_sessions.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            No shifts yet today.
          </Text>
        ) : (
          home.today_sessions.map((s, i) => (
            <Divided key={s.id} first={i === 0}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
                <Text size={14} weight="medium">
                  {s.shift_period ? shiftName(s.shift_period) : 'Shift'}
                </Text>
                <Text size={14} color={colors.muted} tabular>
                  {formatClock(s.check_in_at)} – {s.check_out_at ? formatClock(s.check_out_at) : 'now'}
                  {s.duration_minutes !== null ? ` · ${formatDuration(s.duration_minutes)}` : ''}
                </Text>
              </View>
            </Divided>
          ))
        )}
      </Card>

      {pendingSwitch && open ? (
        <ConfirmCard
          title={`Switch to ${shiftName(pendingSwitch).toLowerCase()}?`}
          body={`You're checked into ${open.shift_period ? shiftName(open.shift_period).toLowerCase() : 'another shift'}. Switching checks you out of it first.`}
          confirmLabel="Switch"
          busy={checkIn.isPending}
          onCancel={() => setPendingSwitch(null)}
          onConfirm={() => checkIn.mutate({ shiftPeriod: pendingSwitch, confirmSwitch: true })}
        />
      ) : null}
    </Screen>
  )
}

// Morning / Afternoon, 2 columns (the driver app's segmented control, without student counts).
function ShiftSwitch({ selected, onSelect }: { selected: ShiftPeriod; onSelect: (p: ShiftPeriod) => void }) {
  const colors = useColors()
  return (
    <View
      accessibilityRole="tablist"
      style={{ flexDirection: 'row', gap: 3, padding: 3, borderRadius: radius.card, backgroundColor: colors.segTrack }}
    >
      {(['morning', 'afternoon'] as const).map((p) => {
        const active = selected === p
        return (
          <Pressable
            key={p}
            onPress={() => onSelect(p)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${shiftName(p)} shift`}
            style={{
              flex: 1,
              height: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              borderRadius: radius.row,
              backgroundColor: active ? colors.segOn : 'transparent',
            }}
          >
            <Icon name={p === 'morning' ? 'wb-twilight' : 'wb-sunny'} size={18} color={active ? colors.ink : colors.muted} />
            <Text size={14} weight="medium" color={active ? colors.ink : colors.muted}>
              {shiftName(p)}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}
