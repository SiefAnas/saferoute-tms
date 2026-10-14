import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { useRouter } from 'expo-router'
import * as Notifications from 'expo-notifications'
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { api } from '@/api'
import type { NotificationList } from '@/api/types'
import { notificationIdOf, routeOf } from './logic'
import { registerThisDevice } from './push'

// Same query keys as the website's bell and list.
export function useNotificationList(): UseQueryResult<NotificationList> {
  return useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api.get<NotificationList>('/notifications?limit=50') })
}

export function useUnreadCount(enabled = true): number {
  const q = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread_count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
    enabled,
  })
  return q.data?.unread_count ?? 0
}

export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useMarkAllRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

// Root-level wiring while someone is signed in (app/_layout.tsx):
//  - registers this device for pushes (only if notifications are already allowed: never asks);
//  - a push arriving while the app is open refreshes the bell and the list;
//  - tapping a push (app open, in the background or closed) marks it read and opens data.route,
//    or the notification list when it has no route.
export function usePushSetup(active: boolean) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const handled = useRef<string | null>(null)
  const lastResponse = Notifications.useLastNotificationResponse()

  useEffect(() => {
    if (!active) return
    void registerThisDevice()
    // Back from Settings (where they may have just turned notifications on): try again.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void registerThisDevice()
        void queryClient.invalidateQueries({ queryKey: ['notifications'] })
      }
    })
    const received = Notifications.addNotificationReceivedListener(() => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    })
    return () => {
      sub.remove()
      received.remove()
    }
  }, [active, queryClient])

  useEffect(() => {
    if (!active || !lastResponse) return
    if (lastResponse.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return
    const key = lastResponse.notification.request.identifier
    if (handled.current === key) return
    handled.current = key
    const data = lastResponse.notification.request.content.data
    const id = notificationIdOf(data)
    if (id) {
      void api
        .post(`/notifications/${id}/read`)
        .catch(() => {})
        .finally(() => void queryClient.invalidateQueries({ queryKey: ['notifications'] }))
    }
    // The role's own layout redirects if the route belongs to another app (someone else's push
    // on a shared phone can't open their screens).
    router.push((routeOf(data) ?? '/notifications') as never)
    void Notifications.clearLastNotificationResponseAsync?.()
  }, [active, lastResponse, router, queryClient])
}
