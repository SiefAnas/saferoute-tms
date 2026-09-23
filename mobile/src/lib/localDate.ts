// Calendar dates ("YYYY-MM-DD") in the user's own local timezone.
// Ported unchanged from client/src/lib/localDate.ts so the app and the web app agree.
//
// Never use new Date().toISOString().slice(0, 10) for "today": toISOString is always UTC, so
// in Boston it says tomorrow from ~8pm, and in Egypt (UTC+2/+3) a local midnight turns into
// the previous day. Both happened in this product before this helper existed.

export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// Calendar arithmetic on "YYYY-MM-DD" strings, done on a local-time Date built from the parts
// (so no UTC shift), e.g. the Week tab's previous/next week. Same as the web app's.
export function addDaysISO(iso: string, days: number): string {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return localISODate(new Date(y, m - 1, d + days))
}

// Monday of the week containing `d`, as "YYYY-MM-DD".
export function mondayOf(d: Date = new Date()): string {
  return localISODate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)))
}

// A local Date at midnight for a "YYYY-MM-DD" string, only for display (weekday / month names).
export function localDateOf(iso: string): Date {
  const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// The API sends Postgres DATE columns as "2026-09-22T00:00:00.000Z" (pg turns them into a JS
// Date on a UTC server, then JSON). The date part is already the real calendar date, so read it
// directly. Parsing it with new Date() would move it to the day before anywhere west of UTC.
export function calendarDateOf(value: string): string {
  return value.slice(0, 10)
}
