import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { addDaysISO, localDateOf, localISODate, mondayOf } from '../../lib/localDate'
import { formatTimeOfDay } from '../../lib/format'
import { SectionHeader } from '../../components/mobile'
import { MD_QUERY, useMediaQuery } from '../../lib/useMediaQuery'
import { PageTopBar } from '../../layouts/TopBar'
import { DifferentAddressNote, homeEnd, isDifferent, legOf, placeName } from '../../components/Route'
import { StatusBadge, type BadgeTone } from '../../components/StatusBadge'
import type { ShiftPeriod, TodayScheduleItem, WeekSchedule, WeekScheduleDay } from '../../types/api'

// Driver app, Week tab: the real week from GET /schedule/week (Monday to Sunday), each day's
// morning and afternoon runs with that day's changes, parent skips and no-shows. Previous/next
// move a week at a time. Dates stay "YYYY-MM-DD" strings (lib/localDate.ts), never
// toISOString(). Phones: one column of days. Tablet/desktop: days in a grid.
export function DriverWeekPage() {
  const thisWeek = mondayOf()
  const [start, setStart] = useState(thisWeek)
  const weekQuery = useQuery({
    queryKey: ['schedule-week', start],
    queryFn: () => api.get<WeekSchedule>(`/schedule/week?start=${start}`),
  })
  const today = localISODate()
  const end = addDaysISO(start, 6)
  const range = `${localDateOf(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${localDateOf(end).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
  const runs = weekQuery.data?.days.reduce((n, d) => n + d.morning.length + d.afternoon.length, 0) ?? 0
  const wide = useMediaQuery(MD_QUERY)

  const days = weekQuery.isLoading ? (
    <p className={wide ? 'text-[14px] text-muted' : 'px-5 text-[14px] text-muted'}>Loading…</p>
  ) : weekQuery.isError || !weekQuery.data ? (
    <p className="mx-4 rounded-m bg-alert-bg px-3 py-2 text-[13px] text-alert-fg md:mx-0">Couldn&apos;t load this week. Try again in a moment.</p>
  ) : (
    <div className="mx-4 grid grid-cols-1 gap-3 md:mx-0 md:grid-cols-2 md:gap-4 xl:grid-cols-3 2xl:grid-cols-4">
      {weekQuery.data.days.map((d) => (
        <DayCard key={d.date} day={d} isToday={d.date === today} />
      ))}
    </div>
  )

  // Desktop: the week navigation lives in the top bar, the days fill the width.
  if (wide) {
    return (
      <div className="flex flex-col gap-5">
        <PageTopBar title={start === thisWeek ? 'This week' : 'Week'} subtitle={`${range}${weekQuery.data ? ` · ${runs} ${runs === 1 ? 'stop' : 'stops'}` : ''}`}>
          <WeekButton icon="chevron_left" label="Previous week" onClick={() => setStart(addDaysISO(start, -7))} />
          {start !== thisWeek && (
            <button
              type="button"
              onClick={() => setStart(thisWeek)}
              className="h-10 cursor-pointer rounded-m border border-line bg-surface px-3.5 text-[14px] font-medium text-ink"
            >
              This week
            </button>
          )}
          <WeekButton icon="chevron_right" label="Next week" onClick={() => setStart(addDaysISO(start, 7))} />
        </PageTopBar>
        {days}
      </div>
    )
  }

  return (
    <>
      <SectionHeader title={start === thisWeek ? 'This week' : 'Week'} aside={range} />
      <div className="mx-4 mb-3 flex items-center gap-2">
        <WeekButton icon="chevron_left" label="Previous week" onClick={() => setStart(addDaysISO(start, -7))} />
        <WeekButton icon="chevron_right" label="Next week" onClick={() => setStart(addDaysISO(start, 7))} />
        {start !== thisWeek && (
          <button
            type="button"
            onClick={() => setStart(thisWeek)}
            className="h-10 cursor-pointer rounded-m border border-line bg-surface px-3.5 text-[14px] font-medium text-ink"
          >
            This week
          </button>
        )}
        {weekQuery.data && (
          <span className="ml-auto text-[13px] text-muted">
            {runs} {runs === 1 ? 'stop' : 'stops'}
          </span>
        )}
      </div>

      {days}
    </>
  )
}

function WeekButton({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-m border border-line bg-surface text-ink"
    >
      <span className="material-symbols-outlined !text-[22px]">{icon}</span>
    </button>
  )
}

function DayCard({ day, isToday }: { day: WeekScheduleDay; isToday: boolean }) {
  const date = localDateOf(day.date)
  const empty = day.morning.length === 0 && day.afternoon.length === 0
  return (
    <section
      aria-label={date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
      className={`overflow-hidden rounded-card border bg-surface shadow-card ${isToday ? 'border-action' : 'border-line'}`}
    >
      <div className="flex items-baseline justify-between px-3.5 pt-3 pb-2">
        <span className="text-[15px] font-semibold text-ink">
          {date.toLocaleDateString(undefined, { weekday: 'long' })}
          <span className="font-normal text-muted"> · {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
        </span>
        {isToday && <StatusBadge mobile tone="next" label="Today" />}
      </div>
      {empty ? (
        <p className="px-3.5 pb-3 text-[13px] text-muted">No runs</p>
      ) : (
        <>
          <Run period="morning" items={day.morning} />
          <Run period="afternoon" items={day.afternoon} />
        </>
      )}
    </section>
  )
}

function Run({ period, items }: { period: ShiftPeriod; items: TodayScheduleItem[] }) {
  if (items.length === 0) return null
  const rows = items
    .map((item) => {
      const usual = period === 'morning' ? item.pickup_time : item.dropoff_time
      const changed = period === 'morning' ? item.override?.pickup_time : item.override?.dropoff_time
      return { item, time: changed ?? usual, timeChanged: Boolean(changed) && changed !== usual }
    })
    .sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99') || a.item.student.name.localeCompare(b.item.student.name))
  return (
    <div className="border-t border-divider">
      <div className="flex items-center gap-1.5 px-3.5 pt-2.5 pb-1 text-[12px] font-semibold text-muted">
        <span className="material-symbols-outlined !text-[16px]">{period === 'morning' ? 'wb_twilight' : 'wb_sunny'}</span>
        {period === 'morning' ? 'Morning pickups' : 'Afternoon drop-offs'} · {items.length}
      </div>
      {rows.map(({ item, time, timeChanged }) => {
        const status = statusOf(item, period)
        return (
          <div key={item.assignment_id} className={`flex items-center gap-3 px-3.5 py-2 ${status ? 'opacity-70' : ''}`}>
            <span className={`w-[62px] shrink-0 text-[12px] tabular ${timeChanged ? 'font-semibold text-caution-fg' : 'text-muted'}`}>
              {time ? formatTimeOfDay(time) : '—'}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[14px] font-medium text-ink">{item.student.name}</span>
              {isDifferent(legOf(item.route, period)) && <DifferentAddressNote compact place={homeEnd(legOf(item.route, period)!, period)} />}
              <span className="truncate text-[12px] text-muted">
                {placeName(legOf(item.route, period)?.from)} → {placeName(legOf(item.route, period)?.to)}
                {item.override?.note ? ` · ${item.override.note}` : ''}
              </span>
            </span>
            {status && <StatusBadge mobile tone={status.tone} label={status.label} />}
          </div>
        )
      })}
    </div>
  )
}

function statusOf(item: TodayScheduleItem, period: ShiftPeriod): { tone: BadgeTone; label: string } | null {
  if (item.no_show_reported[period]) return { tone: 'alert', label: 'No-show' }
  if (item.parent_skipped[period]) return { tone: 'info', label: 'Parent skipped' }
  if (item.override?.skip) return { tone: 'info', label: 'No ride' }
  return null
}
