import { AddressText } from './AddressText'
import type { ExtraAddress, RouteLeg, RoutePlace, ShiftPeriod, StudentRoute } from '../types/api'
import { formatWeekdays } from '../lib/weekdays'

// The home end of a leg (pickup in the morning, drop-off in the afternoon).
export function homeEnd(leg: RouteLeg, period: ShiftPeriod): RoutePlace {
  return period === 'morning' ? leg.from : leg.to
}

export function legOf(route: StudentRoute | undefined, period: ShiftPeriod): RouteLeg | null {
  return route?.[period] ?? null
}

// Short name for a route end: the school's name, or the first line of a home/extra address.
export function placeName(p: RoutePlace | undefined): string {
  if (!p) return '—'
  return p.kind === 'school' ? p.label : (p.address?.split(',')[0] ?? p.label)
}

// True when the leg goes to/from an extra address instead of home that day.
export function isDifferent(leg: RouteLeg | null): boolean {
  return Boolean(leg && (leg.from.kind === 'extra' || leg.to.kind === 'extra'))
}

// The highlight: amber tint, a "different route" icon and the label. It must not look like the
// normal routine (brief: "so the eye catches it").
export function DifferentAddressNote({ place, compact = false }: { place: RoutePlace; compact?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-row bg-caution-bg font-semibold text-caution-fg ${
        compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]'
      }`}
    >
      <span className={`material-symbols-outlined shrink-0 ${compact ? '!text-[14px]' : '!text-[16px]'}`}>alt_route</span>
      <span className="truncate">Different address today: {place.label}</span>
    </span>
  )
}

// One place in a route: label, then the address (copyable). Extra addresses get the highlight.
export function PlaceLine({ place }: { place: RoutePlace }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {place.kind === 'extra' ? (
        <DifferentAddressNote place={place} />
      ) : (
        <span className="text-[14px] font-medium text-ink">{place.label}</span>
      )}
      {place.address ? <AddressText address={place.address} /> : <span className="text-[13px] text-muted">No address on file</span>}
    </div>
  )
}

const APPLIES_LABEL: Record<ExtraAddress['applies_to'], string> = {
  morning_pickup: 'Morning pickup',
  afternoon_dropoff: 'Afternoon drop-off',
  both: 'Morning pickup and afternoon drop-off',
}

// "Fridays · Afternoon drop-off · until Jun 30" for an extra address.
export function extraAddressSchedule(x: ExtraAddress): string {
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }
  const dates = x.start_date && x.end_date ? `${fmt(x.start_date)} – ${fmt(x.end_date)}` : x.start_date ? `from ${fmt(x.start_date)}` : x.end_date ? `until ${fmt(x.end_date)}` : null
  return [formatWeekdays(x.days_of_week), APPLIES_LABEL[x.applies_to], dates].filter(Boolean).join(' · ')
}
