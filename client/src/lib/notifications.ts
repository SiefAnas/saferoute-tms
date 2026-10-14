import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import { syncWebPush } from './webPush'
export { badgeText } from './notificationLogic'
import type { NotificationList } from '../types/api'

// Same query keys as the mobile app.
export function useUnreadCount() {
  const queryClient = useQueryClient()
  const q = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => api.get<{ unread_count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  })
  // A push shown by the service worker while a tab is open: refresh the bell and the list now.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'saferoute:notification') void queryClient.invalidateQueries({ queryKey: ['notifications'] })
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [queryClient])
  // Signed in with browser notifications already allowed: keep this browser registered.
  useEffect(() => syncWebPush(), [])
  // Opened from a browser notification (public/sw.js adds ?read=<id>): mark it read, tidy the URL.
  useEffect(() => {
    const url = new URL(window.location.href)
    const id = url.searchParams.get('read')
    if (!id) return
    url.searchParams.delete('read')
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
    void api
      .post(`/notifications/${encodeURIComponent(id)}/read`)
      .catch(() => {})
      .finally(() => void queryClient.invalidateQueries({ queryKey: ['notifications'] }))
  }, [queryClient])
  return q.data?.unread_count ?? 0
}

export function useNotificationList() {
  return useQuery({ queryKey: ['notifications', 'list'], queryFn: () => api.get<NotificationList>('/notifications?limit=50') })
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

