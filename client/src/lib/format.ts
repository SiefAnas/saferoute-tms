export function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  )
}

function dateOnly(iso: string): number {
  const d = new Date(iso)
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

// Mirrors the server's own "active today" range check (start_date <= CURRENT_DATE AND
// (end_date IS NULL OR end_date >= CURRENT_DATE), used in schedule.js/parentPortal.js) for
// display-only client-side derivation — e.g. "which assignment is this student/van's
// current one" on the Students/Fleet pages. Not authoritative; the server re-derives this
// itself wherever it actually matters (eligibility, notifications).
export function isAssignmentActiveToday(startDate: string, endDate: string | null): boolean {
  const today = dateOnly(new Date().toISOString())
  if (dateOnly(startDate) > today) return false
  if (endDate && dateOnly(endDate) < today) return false
  return true
}

export function formatDuration(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60)
  const m = Math.round(totalMinutes % 60)
  if (h === 0) return `${m}m`
  return `${h}h ${m}m`
}

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

// Postgres `time` columns come back as "HH:MM:SS" — render as a friendly clock time.
export function formatTimeOfDay(time: string | null): string {
  if (!time) return '-'
  const [h, m] = time.split(':')
  const d = new Date()
  d.setHours(Number(h), Number(m), 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Dashboard redesign (2026-08-28): the reference mockup had a "Last Sync" column implying
// live device telemetry this app doesn't have. Relabeled "Last Activity" and backed by a
// real timestamp (most recent session check-in/check-out) instead — this formatter is just
// the relative-time display for that real value, not a stand-in for a sync heartbeat.
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const diffMin = Math.round(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.round(diffHr / 24)
  return `${diffDay}d ago`
}
