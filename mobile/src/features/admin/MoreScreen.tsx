import { View } from 'react-native'
import { useAuth } from '@/auth/auth'
import { Button } from '@/components/Button'
import { Card, KeyValueRow, SectionHeader } from '@/components/Card'
import { Screen } from '@/components/Screen'
import { Text } from '@/components/Text'
import { ThemeChooser } from '@/components/ThemeChooser'
import { useColors } from '@/theme/theme'
import { WebsiteRow } from './components'
import type { IconName } from '@/components/Icon'

const ROLE_LABEL: Record<string, string> = {
  company_admin: 'Company admin',
  school_admin: 'School admin',
  school_staff: 'School staff',
}

// The admin apps' last tab: who is signed in, the website pages for everything the app doesn't
// do (editing, assignments, payroll, settings), appearance, and log out.
export function MoreScreen({ links }: { links: { label: string; path: string; icon: IconName }[] }) {
  const colors = useColors()
  const { user, signOut } = useAuth()
  return (
    <Screen>
      <SectionHeader title="More" />
      <Card style={{ marginHorizontal: 16 }}>
        <KeyValueRow label="Signed in as" value={user?.full_name ?? '—'} first />
        <KeyValueRow label="Email" value={user?.email ?? '—'} first={false} />
        <KeyValueRow label="Account" value={ROLE_LABEL[user?.role ?? ''] ?? user?.role ?? '—'} first={false} />
      </Card>

      <SectionHeader title="On the website" />
      <View style={{ marginHorizontal: 16, gap: 8 }}>
        <Text size={13} color={colors.muted} style={{ lineHeight: 18 }}>
          The app covers the day: who is working, people and students, and calling them. Editing and settings are on the website.
        </Text>
        {links.map((l) => (
          <WebsiteRow key={l.path} label={l.label} path={l.path} icon={l.icon} />
        ))}
      </View>

      <SectionHeader title="Appearance" />
      <View style={{ marginHorizontal: 16 }}>
        <ThemeChooser />
      </View>

      <View style={{ marginHorizontal: 16, marginTop: 24 }}>
        <Button label="Log out" variant="outline" icon="logout" onPress={() => void signOut()} />
      </View>
    </Screen>
  )
}
