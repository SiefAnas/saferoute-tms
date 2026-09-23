import { View } from 'react-native'
import { radius, tone, type ToneName } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { Text } from './Text'

export type { ToneName }

// The design's mobile pill: 11px/500, radius 5, no dot (the dot is web-only).
export function StatusBadge({ label, toneName }: { label: string; toneName: ToneName }) {
  const colors = useColors()
  const t = tone(colors, toneName)
  return (
    <View
      style={{
        backgroundColor: t.bg,
        borderRadius: radius.pill,
        paddingHorizontal: 7,
        paddingVertical: 3,
      }}
    >
      <Text size={11} weight="medium" color={t.fg}>
        {label}
      </Text>
    </View>
  )
}

// Full-width tinted strip: the status banner on the parent's child card and the
// "parent skipped" note in the student sheet.
export function Banner({ label, toneName, icon }: { label: string; toneName: ToneName; icon?: React.ReactNode }) {
  const colors = useColors()
  const t = tone(colors, toneName)
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: t.bg,
        borderRadius: radius.row,
        paddingHorizontal: 12,
        paddingVertical: 10,
      }}
    >
      {icon}
      <Text size={13} weight="medium" color={t.fg} style={{ flex: 1 }}>
        {label}
      </Text>
    </View>
  )
}
