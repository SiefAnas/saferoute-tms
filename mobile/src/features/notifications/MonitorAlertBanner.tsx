import { Pressable, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { NotificationList } from '@/api/types'
import { Icon } from '@/components/Icon'
import { Text } from '@/components/Text'
import { formatClock } from '@/lib/format'
import { alertLines } from './logic'

const ALERT_RED = '#b42318'

// The company admin's red banner (branch monitor-crew-status), under the header on every tab:
// unread monitor alerts from the last 12 hours (No show, or still not picked up 4 minutes after
// Running late), so they are seen without opening the bell. Which driver, which monitor, which run,
// what happened. Dismiss marks it read. Same as the website's MonitorAlertBanner.
export function MonitorAlertBanner() {
  const queryClient = useQueryClient()
  const q = useQuery({
    queryKey: ['notifications', 'monitor-alerts'],
    queryFn: () => {
      const since = new Date(Date.now() - 12 * 3600_000).toISOString()
      return api.get<NotificationList>(`/notifications?kind=monitor_alert&unread=1&limit=5&since=${encodeURIComponent(since)}`)
    },
    refetchInterval: 15_000,
  })
  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const items = q.data?.items ?? []
  if (items.length === 0) return null
  return (
    // Same dark red in both themes, so the white text stays readable.
    <View accessibilityRole="alert" style={{ backgroundColor: ALERT_RED }}>
      {items.map((n, i) => {
        const { title, detail } = alertLines(n, formatClock)
        return (
          <View
            key={n.id}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderTopWidth: i ? 1 : 0,
              borderTopColor: 'rgba(255,255,255,0.25)',
            }}
          >
            <Icon name="warning" size={22} color="#ffffff" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text size={14} weight="semibold" color="#ffffff">
                {title}
              </Text>
              <Text size={13} color="#ffffff">
                {detail}
              </Text>
            </View>
            <Pressable
              onPress={() => dismiss.mutate(n.id)}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss: ${title}`}
              hitSlop={8}
              style={{ paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' }}
            >
              <Text size={13} weight="semibold" color="#ffffff">
                Dismiss
              </Text>
            </Pressable>
          </View>
        )
      })}
    </View>
  )
}
