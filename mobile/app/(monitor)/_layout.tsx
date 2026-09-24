import { Redirect, Tabs } from 'expo-router'
import { useAuth } from '@/auth/auth'
import { AppHeader } from '@/components/AppHeader'
import { Icon } from '@/components/Icon'
import { useMonitorHome } from '@/features/monitor/data'
import { vanLabel } from '@/lib/fleet'
import { font } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

// Monitor app shell (monitor-role): the driver app's look with two tabs, Today and Pay. The
// header names the van the monitor rides in.
export default function MonitorLayout() {
  const colors = useColors()
  const { status, user } = useAuth()
  const home = useMonitorHome().data

  if (status === 'signedOut') return <Redirect href="/login" />
  if (user && user.role !== 'monitor') return <Redirect href="/" />

  return (
    <Tabs
      screenOptions={{
        header: () => <AppHeader subtitle={home?.van ? vanLabel(home.van) : null} />,
        tabBarActiveTintColor: colors.tabOn,
        tabBarInactiveTintColor: colors.tabOff,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.line,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 11 },
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <Icon name="badge" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pay"
        options={{
          title: 'Pay',
          tabBarIcon: ({ color }) => <Icon name="payments" size={22} color={color} />,
        }}
      />
    </Tabs>
  )
}
