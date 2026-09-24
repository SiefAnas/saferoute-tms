import { useState, type ReactNode } from 'react'
import { Alert, Linking, Pressable, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { WEB_URL } from '@/config'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Button'
import { CallButton } from '@/components/CallButton'
import { Icon, type IconName } from '@/components/Icon'
import { StatusBadge } from '@/components/StatusBadge'
import { Text } from '@/components/Text'
import { radius, type ToneName } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { websiteUrl } from './logic'

// Shared pieces of the admin screens (company admin, school admin, school staff).

// A row that opens a page of the website in the phone's browser: everything the app doesn't do
// itself ("Open on the website").
export function WebsiteRow({ label, path, icon = 'open-in-new' }: { label: string; path: string; icon?: IconName }) {
  const colors = useColors()
  async function open() {
    const url = websiteUrl(WEB_URL, path)
    try {
      await Linking.openURL(url)
    } catch {
      Alert.alert('Cannot open the website', `Open ${url} in your browser.`)
    }
  }
  return (
    <Pressable
      onPress={open}
      accessibilityRole="link"
      accessibilityLabel={`${label}. Opens the website.`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 48,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: radius.row,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.surface2 : colors.surface,
      })}
    >
      <Icon name={icon} size={18} color={colors.muted} />
      <Text size={14} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text size={12} color={colors.muted}>
        Open on the website
      </Text>
      <Icon name="open-in-new" size={16} color={colors.muted} />
    </Pressable>
  )
}

// A person in a list: avatar, name, one line under it, a status badge, and a call button when
// there is a phone number. Tapping the row opens their details.
export function PersonRow({
  name,
  sub,
  badge,
  phone,
  onPress,
  first,
}: {
  name: string
  sub?: string | null
  badge?: { label: string; tone: ToneName } | null
  phone?: string | null
  onPress?: () => void
  first: boolean
}) {
  const colors = useColors()
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={[name, sub, badge?.label].filter(Boolean).join(', ')}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: colors.divider,
        backgroundColor: pressed ? colors.surface2 : 'transparent',
      })}
    >
      <Avatar name={name} size={36} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text size={15} weight="semibold" numberOfLines={1}>
          {name}
        </Text>
        {sub ? (
          <Text size={12} color={colors.muted} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      {badge ? <StatusBadge label={badge.label} toneName={badge.tone} /> : null}
      {phone ? <CallButton phone={phone} label={`Call ${name}`} /> : null}
    </Pressable>
  )
}

// The temporary password after adding an account or resetting one. Shown once; the admin
// hands it over and the person picks their own at first sign-in.
export function TemporaryPasswordPanel({ name, email, password, onDone, reset = false }: { name: string; email: string; password: string; onDone: () => void; reset?: boolean }) {
  const colors = useColors()
  const [copied, setCopied] = useState(false)
  return (
    <View style={{ gap: 12 }}>
      <Text size={17} weight="semibold">
        {reset ? `New temporary password for ${name}` : `${name} can sign in now`}
      </Text>
      <Text size={14} color={colors.muted} style={{ lineHeight: 20 }}>
        Give {name} this temporary password. They sign in with {email} and choose their own password right away. It is shown only
        this once.
      </Text>
      <View
        style={{
          borderRadius: radius.row,
          borderWidth: 1,
          borderColor: colors.line,
          backgroundColor: colors.surface2,
          paddingVertical: 14,
          alignItems: 'center',
        }}
      >
        <Text size={22} weight="semibold" tabular selectable accessibilityLabel={`Temporary password ${password.split('').join(' ')}`}>
          {password}
        </Text>
      </View>
      <Button
        label={copied ? 'Copied' : 'Copy password'}
        variant="outline"
        icon={copied ? 'check' : 'content-copy'}
        onPress={() => {
          void Clipboard.setStringAsync(password).then(() => setCopied(true))
        }}
      />
      <Button label="Done" onPress={onDone} />
    </View>
  )
}

// Search box for the lists.
export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const colors = useColors()
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        height: 44,
        borderRadius: radius.row,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
        paddingHorizontal: 12,
      }}
    >
      <Icon name="search" size={18} color={colors.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.faint}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel={placeholder}
        style={{ flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.ink }}
      />
    </View>
  )
}

// Two to four options in a row, the driver app's segmented look.
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const colors = useColors()
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 3, padding: 3, borderRadius: radius.card, backgroundColor: colors.segTrack }}>
      {options.map((o) => {
        const active = value === o.value
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{ flex: 1, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: radius.row, backgroundColor: active ? colors.segOn : 'transparent' }}
          >
            <Text size={14} weight="medium" color={active ? colors.ink : colors.muted}>
              {o.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// A figure on the dashboard: label, big number, one line under it.
export function StatTile({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: string; tone?: 'success' | 'caution' }) {
  const colors = useColors()
  const fg = tone === 'success' ? colors.successFg : tone === 'caution' ? colors.cautionFg : colors.ink
  return (
    <View
      style={{
        flexBasis: '47%',
        flexGrow: 1,
        gap: 4,
        padding: 14,
        borderRadius: radius.card,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <Text size={12} color={colors.muted}>
        {label}
      </Text>
      <Text size={26} weight="semibold" color={fg} tabular>
        {value}
      </Text>
      {sub ? (
        <Text size={12} color={colors.muted} numberOfLines={2}>
          {sub}
        </Text>
      ) : null}
    </View>
  )
}
