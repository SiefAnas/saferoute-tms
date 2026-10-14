import { useState } from 'react'
import { View } from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { MonitorHome, MonitorStop, ShiftPeriod } from '@/api/types'
import { Button } from '@/components/Button'
import { Card } from '@/components/Card'
import { ActionError, messageFor } from '@/components/States'
import { Text } from '@/components/Text'
import { shiftName } from '@/features/driver/shift'
import { canReportLate } from '@/features/driver/monitorStop'
import { formatClock } from '@/lib/format'
import { useColors } from '@/theme/theme'
import { ridesToday } from './data'

// The monitor's pickup on the selected run today (branch monitor-crew-status): what the driver
// marked, and "I'm running late", which sends the driver a push. Separate from check-in / hours.
export function PickupCard({ home, shift }: { home: MonitorHome; shift: ShiftPeriod }) {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [told, setTold] = useState(false)
  const late = useMutation({
    mutationFn: () => api.post<MonitorStop>('/monitor/running-late', { shift_period: shift }),
    onMutate: () => setError(null),
    onSuccess: () => setTold(true),
    onError: (err) => setError(messageFor(err, 'Could not tell your driver.')),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['monitor-me'] }),
  })

  const a = home.assignment
  if (!home.driver || !a || !ridesToday(home) || (a.shift_period !== 'both' && a.shift_period !== shift)) return null
  const stop = home.stops?.[shift] ?? null
  const text =
    !stop || stop.status === 'pending'
      ? 'Your driver picks you up at your address before the students.'
      : stop.status === 'late'
        ? stop.late_reported_by === 'driver'
          ? 'Your driver is running late and will be there shortly.'
          : 'Your driver knows you are running late.'
        : stop.status === 'no_show'
          ? 'Your driver marked you as not there. Call your driver if you are on your way.'
          : stop.status === 'picked_up'
            ? `Picked up${stop.picked_up_at ? ` at ${formatClock(stop.picked_up_at)}` : ''}.`
            : `Dropped off${stop.dropped_off_at ? ` at ${formatClock(stop.dropped_off_at)}` : ''}.`

  return (
    <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16, gap: 10 }}>
      <Text size={12} color={colors.muted}>
        {shiftName(shift)} pickup
      </Text>
      <Text size={15}>{text}</Text>
      {told && stop?.status === 'late' ? (
        <Text size={13} color={colors.successFg}>
          Your driver has been told.
        </Text>
      ) : null}
      {canReportLate(stop) ? (
        <View>
          <Button label="I'm running late" icon="schedule" variant="outline" busy={late.isPending} busyLabel="Telling your driver…" onPress={() => late.mutate()} />
        </View>
      ) : null}
      {error ? <ActionError message={error} /> : null}
    </Card>
  )
}
