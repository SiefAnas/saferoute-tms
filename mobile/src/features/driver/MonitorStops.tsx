import { View } from 'react-native'
import type { RunMonitor } from '@/api/types'
import { AddressText } from '@/components/AddressText'
import { CallButton } from '@/components/CallButton'
import { Card, Divided } from '@/components/Card'
import { Icon } from '@/components/Icon'
import { Text } from '@/components/Text'
import { useColors } from '@/theme/theme'

// The monitor(s) riding on this run, shown first: the driver picks them up at their home address
// before the first student stop. Name, phone (tap to call) and address (tap to copy). Renders
// nothing when no monitor rides this run. Same as client/src/pages/driver/MonitorStops.tsx.
// `inline` draws the rows only (inside another card, e.g. a Week day).
export function MonitorStops({ monitors, inline = false }: { monitors: RunMonitor[]; inline?: boolean }) {
  const colors = useColors()
  if (monitors.length === 0) return null
  const rows = monitors.map((m, i) => (
    <Divided key={m.id} first={!inline && i === 0}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
        <Icon name="badge" size={20} color={colors.muted} />
        <View style={{ flex: 1, gap: 1 }}>
          <Text size={12} weight="semibold" color={colors.muted}>
            Pick up first · Your monitor
          </Text>
          <Text size={15} weight="medium" numberOfLines={1}>
            {m.full_name}
          </Text>
          <Text size={13} color={colors.muted} tabular>
            {m.phone ?? 'No phone on file'}
          </Text>
          {m.address ? (
            <AddressText address={m.address} />
          ) : (
            <Text size={13} color={colors.muted}>
              No address on file
            </Text>
          )}
        </View>
        {m.phone ? <CallButton phone={m.phone} label={`Call ${m.full_name}`} /> : null}
      </View>
    </Divided>
  ))
  if (inline) return <>{rows}</>
  return <Card style={{ marginHorizontal: 16, marginBottom: 12 }}>{rows}</Card>
}
