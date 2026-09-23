// Calendar dates ("YYYY-MM-DD") in the user's own local timezone.
//
// Never use new Date().toISOString().slice(0, 10) for "today": toISOString is always UTC, so
// in Boston it says tomorrow from ~8pm, and in Egypt (UTC+2/+3) a local midnight turns into
// the previous day. Both happened in this app before this helper existed.

export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// The API sends Postgres DATE columns as "2026-09-22T00:00:00.000Z" (pg turns them into a JS
// Date on a UTC server, then JSON). The date part is already the real calendar date, so read it
// directly. Parsing it with new Date() would move it to the day before anywhere west of UTC.
export function calendarDateOf(value: string): string {
  return value.slice(0, 10)
}
