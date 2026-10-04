// Display helpers for IANA time zones (company timezone setting).

// "UTC−05:00 · 8:14 AM" for a zone right now (the offset and local time help pick the right one).
export function zoneHint(zone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset', hour: 'numeric', minute: '2-digit' }).formatToParts(now)
    const offset = (parts.find((p) => p.type === 'timeZoneName')?.value ?? '').replace('GMT', 'UTC').replace('-', '−') || 'UTC'
    const time = parts.filter((p) => p.type === 'hour' || p.type === 'minute' || p.type === 'literal' || p.type === 'dayPeriod').map((p) => p.value).join('').trim()
    return `${offset} · ${time}`
  } catch {
    return ''
  }
}
