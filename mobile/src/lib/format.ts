import { calendarDateOf, localISODate } from './localDate'

// Display formatting, ported from client/src/lib/format.ts. Everything here is presentation
// only — business rules (skip eligibility, "already worked this shift", no-shows) are the
// server's call, see API_CONTRACT.md §7.

// Is this UTC instant on the phone's current local calendar day? Used to pick today's rows
// out of GET /trips and GET /sessions, which both return every row ever.
export function isToday(iso: string): boolean {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

// Mirrors the server's own "active today" range check (start_date <= CURRENT_DATE AND
// (end_date IS NULL OR end_date >= CURRENT_DATE)) for display-only derivation — used to find
// which van the driver is on today. Not authoritative.
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

// Local clock time without a leading zero: "6:48 AM".
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })
}

// Postgres `time` columns come back as "HH:MM:SS" — render as a friendly clock time.
export function formatTimeOfDay(time: string | null): string {
  if (!time) return '-'
  const parts = time.split(':')
  const d = new Date()
  d.setHours(Number(parts[0] ?? 0), Number(parts[1] ?? 0), 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// "Tue, Sep 22" for a local Date.
export function formatWeekdayDate(d: Date = new Date()): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
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

export function initials(fullName: string | null | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase()
}

// Strip formatting so tel: links dial reliably.
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`
}
