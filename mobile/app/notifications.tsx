import { useCallback, useEffect, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { Redirect, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { AppNotification } from '@/api/types'
import { useAuth } from '@/auth/auth'
import { Button } from '@/components/Button'
import { Card, Divided } from '@/components/Card'
import { Icon } from '@/components/Icon'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Loading } from '@/components/States'
import { Text } from '@/components/Text'
import { useMarkAllRead, useMarkRead, useNotificationList } from '@/features/notifications/data'
import { routeOf, type PermissionView } from '@/features/notifications/logic'
import { getPermissionView, requestPermission } from '@/features/notifications/push'
import { formatClock } from '@/lib/format'
import { useColors } from '@/theme/theme'

// Notifications (every role): the list of what was sent to this person, newest first, unread in
// bold with a dot. Tapping one marks it read and opens its screen (data.route). The top card is
// where the person turns phone notifications on: our explanation first, then the system prompt.
export default function NotificationsScreen() {
  const colors = useColors()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { status } = useAuth()
  const list = useNotificationList()
  const markRead = useMarkRead()
  const markAll = useMarkAllRead()

  if (status === 'signedOut') return <Redirect href="/login" />

  const items = list.data?.items ?? []
  const unread = list.data?.unread_count ?? 0

  function open(n: AppNotification) {
    if (!n.read_at) markRead.mutate(n.id)
    const route = routeOf(n.data)
    if (route) router.push(route as never)
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: insets.top + 8, paddingHorizontal: 12, paddingBottom: 8 }}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={8}
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="arrow-back" size={22} color={colors.ink} />
        </Pressable>
        <Text size={20} weight="semibold" style={{ flex: 1 }}>
          Notifications
        </Text>
        {unread > 0 ? (
          <Button label="Mark all read" variant="ghost" compact busy={markAll.isPending} onPress={() => markAll.mutate()} />
        ) : null}
      </View>
      <Screen refreshing={list.isFetching && !list.isLoading} onRefresh={() => void list.refetch()}>
        <PermissionCard />
        {list.isLoading ? (
          <Loading label="Loading notifications…" />
        ) : list.error ? (
          <ErrorState error={list.error} onRetry={() => void list.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState icon="notifications-none" title="No notifications yet" body="Reminders and updates from SafeTurns will show here." />
        ) : (
          <Card style={{ marginHorizontal: 16, marginTop: 12 }}>
            {items.map((n, i) => (
              <Divided key={n.id} first={i === 0}>
                <Pressable
                  onPress={() => open(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`${n.read_at ? '' : 'Unread. '}${n.title}. ${n.body}`}
                  style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: pressed ? colors.surface2 : 'transparent' })}
                >
                  <View style={{ width: 8, paddingTop: 7 }}>
                    {!n.read_at ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.action }} /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text size={15} weight={n.read_at ? 'medium' : 'semibold'}>
                      {n.title}
                    </Text>
                    <Text size={14} color={colors.muted} style={{ lineHeight: 19 }}>
                      {n.body}
                    </Text>
                    <Text size={12} color={colors.faint} tabular>
                      {whenText(n.sent_at)}
                    </Text>
                  </View>
                  {routeOf(n.data) ? <Icon name="chevron-right" size={20} color={colors.muted} /> : null}
                </Pressable>
              </Divided>
            ))}
          </Card>
        )}
      </Screen>
    </View>
  )
}

function whenText(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const sameDay = d.toDateString() === today.toDateString()
  return sameDay ? `Today · ${formatClock(iso)}` : `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${formatClock(iso)}`
}

// Turning phone notifications on. Asked only from here, when the person taps the button: iOS
// shows its prompt once in the app's life, so it must come when they understand why. A "no"
// leaves everything else working; after a final "no" the only way back is the phone's Settings.
function PermissionCard() {
  const colors = useColors()
  const [view, setView] = useState<PermissionView | null>(null)
  const [busy, setBusy] = useState(false)
  const refresh = useCallback(() => {
    void getPermissionView().then(setView).catch(() => setView('unsupported'))
  }, [])
  useEffect(refresh, [refresh])

  if (!view || view === 'on' || view === 'unsupported') return null
  return (
    <Card style={{ marginHorizontal: 16, marginTop: 8, padding: 16, gap: 10 }}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
        <Icon name="notifications-active" size={22} color={colors.ink} />
        <Text size={15} weight="semibold" style={{ flex: 1 }}>
          Turn on notifications
        </Text>
      </View>
      <Text size={14} color={colors.muted} style={{ lineHeight: 19 }}>
        {view === 'ask'
          ? 'Get reminders and updates on this phone, even when SafeTurns is closed. You can turn them off any time.'
          : "Notifications are off for SafeTurns. Turn them on in your phone's Settings. Everything still shows in this list."}
      </Text>
      {view === 'ask' ? (
        <Button
          label="Turn on"
          compact
          busy={busy}
          onPress={() => {
            setBusy(true)
            void requestPermission()
              .then(setView)
              .catch(refresh)
              .finally(() => setBusy(false))
          }}
        />
      ) : (
        <Button label="Open Settings" variant="outline" compact onPress={() => void Linking.openSettings()} />
      )}
    </Card>
  )
}
