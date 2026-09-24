import { Redirect, Tabs } from 'expo-router'
import { useAuth } from '@/auth/auth'
import { AppHeader } from '@/components/AppHeader'
import { Icon } from '@/components/Icon'
import { font } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

// Company admin app (mobile-admin-roles): the day at a glance, people, students, and "More"
// (the website for everything else). Same shell as the driver app.
export default function CompanyLayout() {
  const colors = useColors()
  const { status, user } = useAuth()

  if (status === 'signedOut') return <Redirect href="/login" />
  if (user && user.role !== 'company_admin') return <Redirect href="/" />

  return (
    <Tabs
      screenOptions={{
        header: () => <AppHeader subtitle="Company admin" />,
        tabBarActiveTintColor: colors.tabOn,
        tabBarInactiveTintColor: colors.tabOff,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, borderTopWidth: 1 },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="home" options={{ title: 'Today', tabBarIcon: ({ color }) => <Icon name="dashboard" size={22} color={color} /> }} />
      <Tabs.Screen name="people" options={{ title: 'People', tabBarIcon: ({ color }) => <Icon name="groups" size={22} color={color} /> }} />
      <Tabs.Screen name="students" options={{ title: 'Students', tabBarIcon: ({ color }) => <Icon name="school" size={22} color={color} /> }} />
      <Tabs.Screen name="more" options={{ title: 'More', tabBarIcon: ({ color }) => <Icon name="more-horiz" size={22} color={color} /> }} />
    </Tabs>
  )
}
