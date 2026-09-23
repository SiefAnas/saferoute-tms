import { localISODate, calendarDateOf } from './localDate.ts'

export function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return (
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  )
}


// Mirrors the server's own "active today" range check (start_date <= CURRENT_DATE AND
// (end_date IS NULL OR end_date >= CURRENT_DATE), used in schedule.js/parentPortal.js) for
// display-only client-side derivation — e.g. "which assignment is this student/van's
// current one" on the Students/Fleet pages. Not authoritative; the server re-derives this
// itself wherever it actually matters (eligibility, notifications).
export function isAssignmentActiveToday(startDate: string, endDate: string | null): boolean {
  // Plain "YYYY-MM-DD" strings compare correctly as text, no Date parsing needed.
  const today = localISODate()
  if (calendarDateOf(startDate) > today) return false
  if (endDate && calendarDateOf(endDate) < today) return false
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

// "Sep 14" from a timestamp (local time).
export function formatMonthDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// "Tue, Sep 22" for a local Date.
export function formatWeekdayDate(d: Date = new Date()): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// "Sep 14" for a Postgres DATE value ("2026-09-14T00:00:00.000Z"). Reads the calendar date as
// written instead of letting new Date() shift it to the day before west of UTC.
export function formatCalendarMonthDay(value: string): string {
  const [y, m, d] = calendarDateOf(value).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// "$22.00 / hr" or "$160.00 / day".
export function formatRate(rateCents: number, rateType: 'hourly' | 'daily'): string {
  return `${formatMoney(rateCents)} / ${rateType === 'hourly' ? 'hr' : 'day'}`
}

// "Good morning" / "Good afternoon" / "Good evening" by local time of day.
export function greeting(d: Date = new Date()): string {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function firstName(fullName: string | null | undefined): string {
  return (fullName ?? '').trim().split(/\s+/)[0] ?? ''
}
