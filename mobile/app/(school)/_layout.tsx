import { Redirect, Tabs } from 'expo-router'
import { useAuth } from '@/auth/auth'
import { AppHeader } from '@/components/AppHeader'
import { Icon } from '@/components/Icon'
import { font } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

// School admin and school staff app (mobile-admin-roles): confirm students as they arrive,
// look up a student's ride and call the driver or parent, and the website for the rest.
export default function SchoolLayout() {
  const colors = useColors()
  const { status, user } = useAuth()

  if (status === 'signedOut') return <Redirect href="/login" />
  if (user && user.role !== 'school_admin' && user.role !== 'school_staff') return <Redirect href="/" />

  return (
    <Tabs
      screenOptions={{
        header: () => <AppHeader subtitle={user?.role === 'school_admin' ? 'School admin' : 'School staff'} />,
        tabBarActiveTintColor: colors.tabOn,
        tabBarInactiveTintColor: colors.tabOff,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, borderTopWidth: 1 },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="pickup" options={{ title: 'Pickup', tabBarIcon: ({ color }) => <Icon name="how-to-reg" size={22} color={color} /> }} />
      <Tabs.Screen name="students" options={{ title: 'Students', tabBarIcon: ({ color }) => <Icon name="groups" size={22} color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color }) => <Icon name="more-horiz" size={22} color={color} /> }} />
    </Tabs>
  )
}
