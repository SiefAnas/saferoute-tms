import type { ReactNode } from 'react'
import { View, type StyleProp, type ViewStyle } from 'react-native'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { Text } from './Text'

// Mobile cards: surface fill, a hairline border and radius 10 (design 3a).
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const colors = useColors()
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          borderWidth: 1,
          borderRadius: radius.card,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  )
}

// Rows inside a card are separated by hairlines, not gaps.
export function Divided({ children, first }: { children: ReactNode; first: boolean }) {
  const colors = useColors()
  return (
    <View style={first ? undefined : { borderTopWidth: 1, borderTopColor: colors.divider }}>{children}</View>
  )
}

export function SectionHeader({ title, aside }: { title: string; aside?: string }) {
  const colors = useColors()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 10,
        gap: 8,
      }}
    >
      <Text size={17} weight="semibold">
        {title}
      </Text>
      {aside ? (
        <Text size={13} color={colors.muted}>
          {aside}
        </Text>
      ) : null}
    </View>
  )
}

// Label on the left, value on the right — the "Today" card in the parent app and the key/value
// rows in the student sheet.
export function KeyValueRow({ label, value, first }: { label: string; value: string; first: boolean }) {
  const colors = useColors()
  return (
    <Divided first={first}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 11,
        }}
      >
        <Text size={14} color={colors.muted}>
          {label}
        </Text>
        <Text size={14} weight="medium" tabular style={{ flexShrink: 1, textAlign: 'right' }}>
          {value}
        </Text>
      </View>
    </Divided>
  )
}
