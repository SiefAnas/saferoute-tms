import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/auth/auth'
import { firstName, formatWeekdayDate, greeting } from '@/lib/format'
import { THEME_CYCLE, useColors, useTheme } from '@/theme/theme'
import { Icon } from './Icon'
import { Text } from './Text'

// The header the design puts on every tab: a greeting that changes with the time of day, then
// today's date plus whatever context that app has (the driver's van).
//
// Top right: the theme button (cycles System → Light → Dark, saved on the phone) and Log out,
// which the driver app otherwise has nowhere to live (its tabs are Today / Trips / Week / Pay).
export function AppHeader({ subtitle }: { subtitle?: string | null }) {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const { user, signOut } = useAuth()
  const { preference, setPreference } = useTheme()
  const theme = THEME_CYCLE[preference]
  const roundButton = ({ pressed }: { pressed: boolean }) => ({
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: pressed ? colors.surface2 : colors.surface,
  })

  const line = [formatWeekdayDate(), subtitle].filter(Boolean).join(' · ')

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        backgroundColor: colors.bg,
        paddingTop: insets.top + 12,
        paddingBottom: 6,
        paddingHorizontal: 20,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text size={24} weight="semibold" style={{ letterSpacing: -0.48 }}>
          {greeting()}
          {user?.full_name ? `, ${firstName(user.full_name)}` : ''}
        </Text>
        <Text size={13} color={colors.muted} tabular>
          {line}
        </Text>
      </View>
      <Pressable
        onPress={() => setPreference(theme.next)}
        accessibilityRole="button"
        accessibilityLabel={`Theme: ${theme.label}. Tap for ${THEME_CYCLE[theme.next].label}.`}
        hitSlop={8}
        style={roundButton}
      >
        <Icon name={theme.icon} size={18} color={colors.ink} />
      </Pressable>
      <Pressable onPress={() => void signOut()} accessibilityRole="button" accessibilityLabel="Log out" hitSlop={8} style={roundButton}>
        <Icon name="logout" size={18} color={colors.ink} />
      </Pressable>
    </View>
  )
}
