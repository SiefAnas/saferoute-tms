import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { NotificationList } from '../types/api'

// The company admin's red banner (branch monitor-crew-status): unread monitor alerts from the last
// 12 hours ("No show", "still not picked up 4 minutes after Running late"), pinned above every page
// while the website is open, so they are seen without opening the bell. Each says which driver,
// which monitor, which run and what happened. Dismiss = mark it read (also clears it in the bell).
// Same dark red in both themes (white text stays readable). Polls every 15 s; a browser push arriving refreshes it at once (lib/notifications.ts).
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const items = q.data?.items ?? []
  if (items.length === 0) return null
  return (
    <div role="alert" aria-live="assertive" className="flex shrink-0 flex-col gap-px bg-[#b42318]">
      {items.map((n) => {
        const d = n.data as { event?: string; monitor_name?: string }
        const what = d.event === 'no_show' ? 'No show' : 'Not picked up'
        const time = new Date(n.sent_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        return (
          <div key={n.id} className="flex items-center gap-3 px-4 py-2.5 text-white md:px-7">
            <span className="material-symbols-outlined !text-[22px]">warning</span>
            <span className="flex min-w-0 flex-1 flex-col text-[14px] leading-snug">
              <span className="font-semibold">
                Monitor {what.toLowerCase()}: {d.monitor_name ?? 'monitor'} · {time}
              </span>
              <span className="opacity-90">{n.body}</span>
            </span>
            <button
              type="button"
              onClick={() => dismiss.mutate(n.id)}
              className="shrink-0 cursor-pointer rounded-row border border-white/60 px-3 py-1.5 text-[13px] font-semibold hover:bg-white/10"
            >
              Dismiss
            </button>
          </div>
        )
      })}
    </div>
  )
}
