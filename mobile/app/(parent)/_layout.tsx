import { Redirect, Tabs } from 'expo-router'
import { useAuth } from '@/auth/auth'
import { AppHeader } from '@/components/AppHeader'
import { Icon } from '@/components/Icon'
import { font } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

// Parent app shell (design 5b): the same mobile tokens as the driver app, with two tabs.
export default function ParentLayout() {
  const colors = useColors()
  const { status, user } = useAuth()

  if (status === 'signedOut') return <Redirect href="/login" />
  if (user && user.role !== 'parent') return <Redirect href="/" />

  return (
    <Tabs
      screenOptions={{
        header: () => <AppHeader />,
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
        name="students"
        options={{
          title: 'Students',
          tabBarIcon: ({ color }) => <Icon name="group" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => <Icon name="account-circle" size={22} color={color} />,
        }}
      />
    </Tabs>
  )
}
