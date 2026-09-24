import type { ExtraAddress, RouteLeg, RoutePlace, ShiftPeriod, StudentRoute } from '@/api/types'
import { formatWeekdays } from './weekdays'

// Route helpers, the same as the web app's components/Route.tsx. The server decides the route
// (morning home → school, afternoon school → home, or an extra address instead of home).

export function legOf(route: StudentRoute | undefined, period: ShiftPeriod): RouteLeg | null {
  return route?.[period] ?? null
}

// The home end of a leg: the pickup in the morning, the drop-off in the afternoon.
export function homeEnd(leg: RouteLeg, period: ShiftPeriod): RoutePlace {
  return period === 'morning' ? leg.from : leg.to
}

export function isDifferent(leg: RouteLeg | null): boolean {
  return Boolean(leg && (leg.from.kind === 'extra' || leg.to.kind === 'extra'))
}

// Short name: the school's name, or the first line of a home / extra address.
export function placeName(p: RoutePlace | undefined): string {
  if (!p) return '—'
  return p.kind === 'school' ? p.label : (p.address?.split(',')[0] ?? p.label)
}

const APPLIES_LABEL: Record<ExtraAddress['applies_to'], string> = {
  morning_pickup: 'Morning pickup',
  afternoon_dropoff: 'Afternoon drop-off',
  both: 'Morning pickup and afternoon drop-off',
}

// "Fri · Afternoon drop-off · until Jun 30, 2027".
export function extraAddressSchedule(x: ExtraAddress): string {
  const fmt = (iso: string) => {
    const [y = 1970, m = 1, d = 1] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const dates =
    x.start_date && x.end_date
      ? `${fmt(x.start_date)} – ${fmt(x.end_date)}`
      : x.start_date
        ? `from ${fmt(x.start_date)}`
        : x.end_date
          ? `until ${fmt(x.end_date)}`
          : null
  return [formatWeekdays(x.days_of_week), APPLIES_LABEL[x.applies_to], dates].filter(Boolean).join(' · ')
}
