import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { Icon, type IconName } from './Icon'
import { Text } from './Text'

type Variant = 'primary' | 'outline' | 'danger' | 'ghost'

interface Props {
  label: string
  onPress: () => void
  variant?: Variant
  icon?: IconName
  // Drivers tap this in a moving van, so the design's thumb action is 52px tall. `compact`
  // (38px) is for secondary actions inside cards.
  compact?: boolean
  disabled?: boolean
  busy?: boolean
  busyLabel?: string
  style?: StyleProp<ViewStyle>
  accessibilityHint?: string
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  compact = false,
  disabled = false,
  busy = false,
  busyLabel,
  style,
  accessibilityHint,
}: Props) {
  const colors = useColors()
  const height = compact ? 38 : 52
  const isDisabled = disabled || busy

  const bg =
    variant === 'primary' ? colors.action : variant === 'ghost' ? 'transparent' : colors.outlineBg
  const fg =
    variant === 'primary' ? colors.onAction : variant === 'danger' ? colors.dangerInk : colors.ink
  const borderWidth = variant === 'outline' || variant === 'danger' ? 1 : 0

  const shown = busy ? (busyLabel ?? 'Please wait…') : label

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy }}
      // Press feedback from the design: primary buttons scale to .98.
      style={({ pressed }) => [
        styles.base,
        {
          height,
          backgroundColor: bg,
          borderWidth,
          borderColor: colors.outline,
          opacity: isDisabled ? 0.5 : 1,
          transform: [{ scale: pressed && !isDisabled ? 0.98 : 1 }],
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : icon ? (
        <Icon name={icon} size={20} color={fg} />
      ) : null}
      <View>
        <Text size={15} weight="semibold" color={fg}>
          {shown}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: radius.button,
    paddingHorizontal: 16,
  },
})
