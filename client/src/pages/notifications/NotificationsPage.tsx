import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/auth'
import { Button } from '../../components/Button'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { PageIntro } from '../../components/Records'
import { PageTopBar } from '../../layouts/TopBar'
import { useMarkAllRead, useMarkRead, useNotificationList } from '../../lib/notifications'
import { enableWebPush, webPushState, type WebPushState } from '../../lib/webPush'
import { webRouteOf } from '../../lib/notificationLogic'
import { MD_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import type { AppNotification, Role } from '../../types/api'

// Roles shown in the phone shell, which gives pages no side padding of its own (as AccountPage).
const PHONE_SHELL_ROLES: Role[] = ['driver', 'parent', 'monitor']

// Notifications (every role): what was sent to this person, newest first; unread in bold with a
// dot. Clicking one marks it read and opens its page (data.web_route). The card at the top turns
// on browser notifications for this browser (the permission prompt only appears on that click).
export function NotificationsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const wide = useMediaQuery(MD_QUERY)
  const list = useNotificationList()
  const markRead = useMarkRead()
  const markAll = useMarkAllRead()
  const items = list.data?.items ?? []
  const unread = list.data?.unread_count ?? 0
  const padded = !wide && user && PHONE_SHELL_ROLES.includes(user.role)

  function open(n: AppNotification) {
    if (!n.read_at) markRead.mutate(n.id)
    const route = webRouteOf(n.data)
    if (route) navigate(route)
  }

  return (
    <div className={`flex flex-col gap-5 ${padded ? 'px-4 pt-4' : ''}`}>
      <PageTopBar title="Notifications">
        {unread > 0 && (
          <Button variant="outline" disabled={markAll.isPending} onClick={() => markAll.mutate()}>
            <span className="material-symbols-outlined !text-[18px]">done_all</span>
            Mark all read
          </Button>
        )}
      </PageTopBar>
      <PageIntro>Reminders and updates from SafeTurns.</PageIntro>
      <BrowserPushCard />
      {list.isLoading ? (
        <p className="text-[14px] text-muted">Loading…</p>
      ) : list.isError ? (
        <p role="alert" className="rounded-row bg-alert-bg px-4 py-2.5 text-[14px] text-alert-fg">
          Could not load your notifications.
        </p>
      ) : items.length === 0 ? (
        <EmptyState icon="notifications" title="No notifications yet" body="Reminders and updates from SafeTurns will show here." />
      ) : (
        <Card className="overflow-hidden">
          <ul>
            {items.map((n, i) => (
              <li key={n.id} className={i ? 'border-t border-divider' : ''}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-surface-2/60"
                >
                  <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${n.read_at ? '' : 'bg-action'}`} aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    {!n.read_at && <span className="sr-only">Unread.</span>}
                    <span className={`text-[15px] text-ink ${n.read_at ? 'font-medium' : 'font-semibold'}`}>{n.title}</span>
                    <span className="text-[14px] text-muted">{n.body}</span>
                    <span className="text-[12px] text-faint tabular">{new Date(n.sent_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  </span>
                  {webRouteOf(n.data) && <span className="material-symbols-outlined !text-[20px] text-muted">chevron_right</span>}
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

// Browser notifications for this browser. Nothing is asked until "Turn on" is clicked; a "Block"
// leaves the page and the bell working, and says how to undo it.
function BrowserPushCard() {
  const [state, setState] = useState<WebPushState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void webPushState().then(setState).catch(() => setState('unsupported'))
  }, [])
  if (!state || state === 'on' || state === 'unconfigured') return null
  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <span className="flex items-start gap-3">
        <span className="material-symbols-outlined !text-[22px] text-ink">notifications_active</span>
        <span className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold text-ink">Browser notifications</span>
          <span className="text-[13px] text-muted">
            {state === 'off'
              ? 'Get reminders on this computer even when SafeTurns is closed (while the browser is running).'
              : state === 'blocked'
                ? "Blocked for SafeTurns in this browser. Allow notifications in the site settings (the icon next to the address), then reload."
                : "This browser can't show notifications from SafeTurns. On iPhone, add SafeTurns to your Home Screen first. Everything still shows here."}
          </span>
        </span>
      </span>
      {state === 'off' && (
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void enableWebPush()
              .then(setState)
              .catch(() => setState('off'))
              .finally(() => setBusy(false))
          }}
        >
          {busy ? 'Please wait…' : 'Turn on'}
        </Button>
      )}
    </Card>
  )
}
