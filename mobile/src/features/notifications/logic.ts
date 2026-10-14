// Pure rules for notifications, kept apart from expo-notifications so they can be unit tested.

// The screen a notification opens: only an in-app path ("/(driver)/today"), never a URL, so a
// payload can't send the app somewhere outside it. Anything else opens the notification list.
export function routeOf(data: unknown): string | null {
  const route = (data as { route?: unknown } | null | undefined)?.route
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) return null
  return route
}

export function notificationIdOf(data: unknown): string | null {
  const id = (data as { notification_id?: unknown } | null | undefined)?.notification_id
  return typeof id === 'string' && id ? id : null
}

// What the permission card shows. 'ask' = never asked (or Android lets us ask again): show our own
// explanation first, then the system prompt. 'settings' = the person said no and the system won't
// ask again (iOS after the first "Don't Allow"), so only the phone's Settings can turn it on.
export type PermissionView = 'on' | 'ask' | 'settings' | 'unsupported'
export function permissionView(p: { granted: boolean; canAskAgain: boolean } | null, isDevice: boolean): PermissionView {
  if (!isDevice) return 'unsupported'
  if (!p) return 'ask'
  if (p.granted) return 'on'
  return p.canAskAgain ? 'ask' : 'settings'
}

// "99+" on the bell past 99.
export function badgeText(count: number): string | null {
  if (!count || count < 1) return null
  return count > 99 ? '99+' : String(count)
}

// The admin banner's two lines for a monitor alert (data.kind 'monitor_alert'): what happened to
// which monitor and when, then the push text (which names the driver, the run and the van).
export function alertLines(
  n: { body: string; sent_at: string; data: Record<string, unknown> },
  clock: (iso: string) => string,
): { title: string; detail: string } {
  const d = n.data as { event?: string; monitor_name?: string }
  const what = d.event === 'no_show' ? 'no show' : 'not picked up'
  return { title: `Monitor ${what}: ${d.monitor_name ?? 'monitor'} · ${clock(n.sent_at)}`, detail: n.body }
}
