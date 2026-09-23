import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatTimeOfDay } from '../../lib/format'
import { Button } from '../../components/Button'
import { EmptyState } from '../../components/EmptyState'
import { SectionHeader } from '../../components/mobile'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import { clockTime, useTodaySchedule, useTodaysTrips } from './driverData'

interface Row {
  key: string
  time: string
  sortKey: string
  name: string
  kind: string
  label: string
  tone: BadgeTone
}

// Today's instant for a "HH:MM:SS" time, so scheduled times sort alongside real timestamps.
function todayAt(time: string) {
  const [h, m] = time.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

// Driver app, Trips tab (design 3a): today's logged pickups/drop-offs and reported no-shows.
// Trips come from GET /trips; no-shows have no row of their own in that list, so they come from
// today's schedule flags and show at their scheduled time.
export function DriverTripsPage() {
  const navigate = useNavigate()
  const { query: tripsQuery, today } = useTodaysTrips()
  const scheduleQuery = useTodaySchedule()

  const rows = useMemo(() => {
    const items = scheduleQuery.data ?? []
    const nameOf = new Map(items.map((i) => [i.student.id, i.student.name]))
    const out: Row[] = today.map((t) => ({
      key: t.id,
      time: clockTime(t.created_at),
      sortKey: t.created_at,
      name: nameOf.get(t.student_id) ?? 'Student',
      kind: t.trip_type === 'pickup' ? 'Pickup' : 'Drop-off',
      label: t.status === 'complete' ? 'Confirmed' : 'Awaiting school',
      tone: t.status === 'complete' ? 'success' : 'caution',
    }))
    for (const i of items) {
      for (const period of ['morning', 'afternoon'] as const) {
        if (!i.no_show_reported[period]) continue
        const scheduled = period === 'morning' ? (i.override?.pickup_time ?? i.pickup_time) : (i.override?.dropoff_time ?? i.dropoff_time)
        out.push({
          key: `${i.assignment_id}-${period}-noshow`,
          time: scheduled ? formatTimeOfDay(scheduled) : '—',
          sortKey: scheduled ? todayAt(scheduled) : '',
          name: i.student.name,
          kind: 'No-show reported',
          label: 'No-show',
          tone: 'alert',
        })
      }
    }
    return out.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
  }, [today, scheduleQuery.data])

  return (
    <>
      <SectionHeader title="Today's trips" aside={`${rows.length} ${rows.length === 1 ? 'trip' : 'trips'}`} />
      {tripsQuery.isLoading ? (
        <p className="px-5 text-[14px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon="receipt_long"
          title="No trips yet today"
          body="Each pickup and drop-off you log lands here and waits for the school to confirm it."
          action={
            <Button variant="outline" size="sm" className="h-[34px] font-medium" onClick={() => navigate('/driver')}>
              Go to today's students
            </Button>
          }
        />
      ) : (
        <div className="mx-4 overflow-hidden rounded-m border border-line bg-surface shadow-card">
          {rows.map((r, i) => (
            <div key={r.key} className={`grid grid-cols-[62px_1fr_auto] items-center gap-2.5 px-3.5 py-3 ${i ? 'border-t border-divider' : ''}`}>
              <span className="text-[12px] text-muted tabular">{r.time}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[14px] font-medium text-ink">{r.name}</span>
                <span className="text-[12px] text-muted">{r.kind}</span>
              </span>
              <StatusBadge mobile tone={r.tone} label={r.label} />
            </div>
          ))}
        </div>
      )}
    </>
  )
}
