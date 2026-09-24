import { View } from 'react-native'
import type { RoutePlace } from '@/api/types'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { AddressText } from './AddressText'
import { Icon } from './Icon'
import { Text } from './Text'

// The highlight for an extra address: amber tint, a "different route" icon and the label, so it
// can't pass for the usual routine.
export function DifferentAddressNote({ place, compact = false }: { place: RoutePlace; compact?: boolean }) {
  const colors = useColors()
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={`Different address today: ${place.label}`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 5,
        borderRadius: radius.row,
        backgroundColor: colors.cautionBg,
        paddingHorizontal: compact ? 6 : 10,
        paddingVertical: compact ? 2 : 5,
      }}
    >
      <Icon name="alt-route" size={compact ? 14 : 16} color={colors.cautionFg} />
      <Text size={compact ? 11 : 12} weight="semibold" color={colors.cautionFg} numberOfLines={1}>
        Different address today: {place.label}
      </Text>
    </View>
  )
}

// A place in a route: the label (or the highlight), then the copyable address.
export function PlaceLine({ place }: { place: RoutePlace }) {
  const colors = useColors()
  return (
    <View style={{ gap: 3 }}>
      {place.kind === 'extra' ? (
        <DifferentAddressNote place={place} />
      ) : (
        <Text size={14} weight="medium">
          {place.label}
        </Text>
      )}
      {place.address ? (
        <AddressText address={place.address} />
      ) : (
        <Text size={13} color={colors.muted}>
          No address on file
        </Text>
      )}
    </View>
  )
}

// The pure helpers live in lib/route.ts (no React Native, so jest can test them).
export { extraAddressSchedule, homeEnd, isDifferent, legOf, placeName } from '@/lib/route'
