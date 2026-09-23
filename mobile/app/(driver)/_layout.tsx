import { Redirect, Tabs } from 'expo-router'
import { useAuth } from '@/auth/auth'
import { AppHeader } from '@/components/AppHeader'
import { Icon } from '@/components/Icon'
import { useMyVan } from '@/features/driver/data'
import { vanLabel } from '@/lib/fleet'
import { font } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

// Driver app shell (design 3a): no sidebar, a scroll area per tab, and a fixed bottom tab bar
// with Today · Trips · Week · Pay in that order.
export default function DriverLayout() {
  const colors = useColors()
  const { status, user } = useAuth()
  const { van } = useMyVan()

  // Guard the whole group: a parent who somehow lands on a driver URL (a deep link, or a
  // different person signing in on the same phone) gets sent to their own app.
  if (status === 'signedOut') return <Redirect href="/login" />
  if (user && user.role !== 'driver') return <Redirect href="/" />

  return (
    <Tabs
      screenOptions={{
        header: () => <AppHeader subtitle={van ? vanLabel(van) : null} />,
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
        name="today"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <Icon name="route" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Trips',
          tabBarIcon: ({ color }) => <Icon name="receipt-long" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="week"
        options={{
          title: 'Week',
          tabBarIcon: ({ color }) => <Icon name="calendar-view-week" size={22} color={color} />,
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
