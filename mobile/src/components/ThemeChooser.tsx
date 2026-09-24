import { Pressable, View } from 'react-native'
import { radius } from '@/theme/tokens'
import { useColors, useTheme, type ThemePreference } from '@/theme/theme'
import { Text } from './Text'

const OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// "Appearance": System / Light / Dark as a segmented control. Saved on the phone.
export function ThemeChooser() {
  const colors = useColors()
  const { preference, setPreference } = useTheme()
  return (
    <View style={{ gap: 8 }}>
      <Text size={13} weight="semibold" color={colors.muted}>
        Appearance
      </Text>
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', gap: 3, padding: 3, borderRadius: radius.button, backgroundColor: colors.segTrack }}>
        {OPTIONS.map((o) => {
          const on = preference === o.value
          return (
            <Pressable
              key={o.value}
              onPress={() => setPreference(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              style={{
                flex: 1,
                height: 38,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.row,
                backgroundColor: on ? colors.segOn : 'transparent',
              }}
            >
              <Text size={14} weight={on ? 'semibold' : 'medium'} color={on ? colors.ink : colors.muted}>
                {o.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}
