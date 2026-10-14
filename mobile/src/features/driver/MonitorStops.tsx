import { useState } from 'react'
import { View } from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { MonitorStop, MonitorStopAction, RunMonitor, ShiftPeriod } from '@/api/types'
import { AddressText } from '@/components/AddressText'
import { Button } from '@/components/Button'
import { CallButton } from '@/components/CallButton'
import { Card, Divided } from '@/components/Card'
import { Icon } from '@/components/Icon'
import { ActionError, messageFor } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Text } from '@/components/Text'
import { formatClock } from '@/lib/format'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { driverActions, stopBadge } from './monitorStop'

const ACTION_LABEL: Record<MonitorStopAction, string> = {
  running_late: 'Running late',
  no_show: 'No show',
  picked_up: 'Picked up',
  dropped_off: 'Dropped off',
}

// The monitor(s) riding on this run, shown first and drawn unlike any student row (blue
// background, monitor icon, "MONITOR" tag) so nobody mistakes a monitor for a child. The driver
// picks them up at their address before the first student stop. Name, phone (tap to call),
// address (tap to copy). Renders nothing when no monitor rides this run. Same as
// client/src/pages/driver/MonitorStops.tsx. `inline` draws the rows only (inside a Week day).
// `period` + `actions` (today's run): Picked up / No show / Running late / Dropped off. These never
// block the run and are not the monitor's hours (their own check-in / check-out).
export function MonitorStops({
  monitors,
  inline = false,
  period,
  actions = false,
}: {
  monitors: RunMonitor[]
  inline?: boolean
  period?: ShiftPeriod
  actions?: boolean
}) {
  const colors = useColors()
  if (monitors.length === 0) return null
  const rows = monitors.map((m, i) => (
    <Divided key={m.id} first={!inline && i === 0}>
      <MonitorRow monitor={m} period={period} actions={actions && Boolean(period)} />
    </Divided>
  ))
  const style = { backgroundColor: colors.infoBg, borderColor: colors.infoFg }
  if (inline) return <View style={style}>{rows}</View>
  return <Card style={[{ marginHorizontal: 16, marginBottom: 12, overflow: 'hidden' }, style]}>{rows}</Card>
}

function MonitorRow({ monitor: m, period, actions }: { monitor: RunMonitor; period?: ShiftPeriod; actions: boolean }) {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [confirmNoShow, setConfirmNoShow] = useState(false)
  const stop = m.stop ?? null
  const badge = stopBadge(stop, formatClock)
  const buttons = driverActions(stop?.status ?? 'pending')

  const press = useMutation({
    mutationFn: (action: MonitorStopAction) => api.post<MonitorStop>(`/schedule/monitors/${m.id}/status`, { shift_period: period, action }),
    onMutate: () => setError(null),
    onSuccess: () => setConfirmNoShow(false),
    onError: (err) => setError(messageFor(err, 'Could not save. Try again.')),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['schedule-monitors'] }),
  })

  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.infoFg }}>
          <Icon name="shield" size={20} color={colors.infoBg} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ backgroundColor: colors.infoFg, borderRadius: radius.row, paddingHorizontal: 6, paddingVertical: 1 }}>
              <Text size={10} weight="semibold" color={colors.infoBg}>
                MONITOR
              </Text>
            </View>
            <Text size={12} weight="semibold" color={colors.infoFg}>
              Pick up first
            </Text>
          </View>
          <Text size={15} weight="semibold" numberOfLines={1}>
            {m.full_name}
          </Text>
          <Text size={13} color={colors.infoFg} tabular>
            {m.phone ?? 'No phone on file'}
          </Text>
          {m.address ? (
            <AddressText address={m.address} color={colors.infoFg} />
          ) : (
            <Text size={13} color={colors.infoFg}>
              No address on file
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          {badge ? <StatusBadge label={badge.label} toneName={badge.tone} /> : null}
          {m.phone ? <CallButton phone={m.phone} label={`Call ${m.full_name}`} /> : null}
        </View>
      </View>

      {actions && confirmNoShow ? (
        <View style={{ gap: 8 }}>
          <Text size={13}>Mark {m.full_name} as no show? The office is told right away. You keep going with the students.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Cancel" variant="outline" compact style={{ flex: 1 }} onPress={() => setConfirmNoShow(false)} />
            <Button label="Mark no show" variant="danger" compact style={{ flex: 1 }} busy={press.isPending} onPress={() => press.mutate('no_show')} />
          </View>
        </View>
      ) : actions && buttons.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {buttons.map((a) => (
            <Button
              key={a}
              label={ACTION_LABEL[a]}
              compact
              variant={a === 'picked_up' ? 'primary' : a === 'no_show' ? 'danger' : 'outline'}
              disabled={press.isPending}
              style={{ flexGrow: 1, flexBasis: '45%' }}
              onPress={() => (a === 'no_show' ? setConfirmNoShow(true) : press.mutate(a))}
            />
          ))}
        </View>
      ) : null}
      {actions && stop?.status === 'late' && stop.escalate_at ? (
        <Text size={12} color={colors.infoFg}>
          If not picked up by {formatClock(stop.escalate_at)}, the office is told.
        </Text>
      ) : null}
      {error ? <ActionError message={error} /> : null}
    </View>
  )
}
