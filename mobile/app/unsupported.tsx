import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/auth/auth'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/States'
import { Text } from '@/components/Text'
import { useColors } from '@/theme/theme'

// company_admin, school_admin and school_staff run the business from the website. Rather than
// a half-built version of those screens, they get told where to go, and a way out.
export default function UnsupportedRoleScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const { user, signOut } = useAuth()

  return (
    <View
      style={{
        flex: 1,
        justifyContent: 'center',
        gap: 16,
        backgroundColor: colors.bg,
        paddingTop: insets.top,
        paddingBottom: insets.bottom + 16,
      }}
    >
      <EmptyState
        icon="desktop-windows"
        title="Please use the SafeRoute website for your account"
        body="This app is for drivers and parents. Your account manages schedules, staff and payroll, which all live on the website."
      />
      <View style={{ paddingHorizontal: 16 }}>
        <Button label="Log out" variant="outline" onPress={() => void signOut()} />
      </View>
      <Text size={12} color={colors.faint} style={{ textAlign: 'center' }}>
        Signed in as {user?.email ?? 'unknown'}
      </Text>
    </View>
  )
}
