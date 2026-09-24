import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '@/auth/auth'
import { Button } from '@/components/Button'
import { EmptyState } from '@/components/States'
import { Text } from '@/components/Text'
import { useColors } from '@/theme/theme'

// Only reached by a role this version of the app doesn't know (every current role has its own
// screens). Rather than someone else's app, they get told where to go, and a way out.
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
        body="This version of the app has no screens for your account yet. Everything is on the website, or update the app."
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
