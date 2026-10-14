import { NavLink } from 'react-router-dom'
import { badgeText, useUnreadCount } from '../lib/notifications'

// The bell (every role): unread count, opens /notifications. `sidebar` for the admin sidebar and
// its phone header, `mobile` for the driver / monitor / parent phone header.
export function NotificationBell({ variant }: { variant: 'sidebar' | 'mobile' }) {
  const badge = badgeText(useUnreadCount())
  const base =
    variant === 'mobile'
      ? 'relative flex h-[38px] w-[38px] items-center justify-center rounded-full border border-line bg-surface text-muted'
      : 'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-row text-sidebar-icon hover:bg-sidebar-hover hover:text-sidebar-strong'
  return (
    <NavLink
      to="/notifications"
      aria-label={badge ? `Notifications, ${badge} unread` : 'Notifications'}
      title="Notifications"
      className={base}
    >
      <span className="material-symbols-outlined !text-[20px]">notifications</span>
      {badge && (
        <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-alert-fg px-1 text-[11px] font-semibold text-surface tabular">
          {badge}
        </span>
      )}
    </NavLink>
  )
}
