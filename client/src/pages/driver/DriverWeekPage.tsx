import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { calendarDateOf, localISODate } from '../../lib/localDate'
import { formatTimeOfDay } from '../../lib/format'
import { SectionHeader } from '../../components/mobile'
import { StudentSheet, type SheetTarget } from './StudentSheet'
import { itemsForShift, useDriverSessions, useStudentDetails, useTodaySchedule } from './driverData'
import type { Assignment, ShiftPeriod } from '../../types/api'

interface WeekRow {
  studentId: string
  schoolId: string | null
  name: string
  time: string | null
  changed: boolean
  skipped: boolean
}

interface Strip {
  text: string
  tone: 'caution' | 'alert' | 'info'
}

function mondayOf(d: Date) {
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff)
}

function activeOn(a: Assignment, day: string) {
  return calendarDateOf(a.start_date) <= day && (!a.end_date || calendarDateOf(a.end_date) >= day)
}

const byTime = (a: WeekRow, b: WeekRow) => (a.time ?? '99').localeCompare(b.time ?? '99') || a.name.localeCompare(b.name)

function range(rows: WeekRow[]) {
  const times = rows.filter((r) => !r.skipped && r.time).map((r) => r.time!).sort()
  if (times.length === 0) return ''
  const first = formatTimeOfDay(times[0])
  const last = formatTimeOfDay(times[times.length - 1])
  return first === last ? first : `${first} – ${last}`
}

// Driver app, Week tab (design 3a).
//
// BACKEND GAP: the design wants GET /schedule/week (each day's schedule with that day's
// overrides applied). Only /schedule/today exists, and a driver can't read overrides for other
// days (GET /assignments/:id/overrides is company-admin only). So:
//   - Today's card uses the real /schedule/today (overrides, parent skips, no-shows included).
//   - Other days are built from the driver's real assignments = their USUAL schedule, and the
//     tab says so plainly. Nothing is invented; one-day changes just aren't visible yet.
export function DriverWeekPage() {
  const scheduleQuery = useTodaySchedule()
  const assignmentsQuery = useQuery({ queryKey: ['assignments'], queryFn: () => api.get<Assignment[]>('/assignments') })
  const { sessions } = useDriverSessions()
  const assignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data])
  const details = useStudentDetails(useMemo(() => [...new Set(assignments.map((a) => a.student_id))], [assignments]))

  const todayKey = localISODate()
  const [openDay, setOpenDay] = useState<string | null>(todayKey)
  const [sheet, setSheet] = useState<SheetTarget | null>(null)

  const days = useMemo(() => {
    const monday = mondayOf(new Date())
    const worked = new Set(sessions.map((s) => localISODate(new Date(s.check_in_at))))
    const today = scheduleQuery.data ?? []
    return Array.from({ length: 5 }, (_, i) => {
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i)
      const key = localISODate(date)
      const isToday = key === todayKey
      const rows: Record<ShiftPeriod, WeekRow[]> = { morning: [], afternoon: [] }
      const strips: Strip[] = []

      if (isToday) {
        for (const period of ['morning', 'afternoon'] as const) {
          for (const item of itemsForShift(today, period)) {
            const usual = period === 'morning' ? item.pickup_time : item.dropoff_time
            const over = period === 'morning' ? item.override?.pickup_time : item.override?.dropoff_time
            rows[period].push({
              studentId: item.student.id,
              schoolId: item.school.id,
              name: item.student.name,
              time: over ?? usual,
              changed: Boolean(over) && over !== usual,
              skipped: Boolean(item.override?.skip) || item.parent_skipped[period],
            })
            if (item.parent_skipped[period]) strips.push({ text: `${item.student.name} · parent skipped ${period === 'morning' ? 'morning pickup' : 'afternoon drop-off'}`, tone: 'info' })
          }
        }
        for (const item of today) {
          if (item.override?.skip) strips.push({ text: `${item.student.name} · no ride today${item.override.note ? ` (${item.override.note})` : ''}`, tone: 'alert' })
          else if (item.override && (item.override.pickup_time || item.override.dropoff_time)) {
            const t = item.override.pickup_time ?? item.override.dropoff_time
            strips.push({
              text: `${item.student.name} · ${item.override.pickup_time ? 'pickup' : 'drop-off'} moved to ${formatTimeOfDay(t)}${item.override.note ? ` (${item.override.note})` : ''}`,
              tone: 'caution',
            })
          }
        }
      } else {
        for (const a of assignments) {
          if (!activeOn(a, key)) continue
          const s = details.get(a.student_id)
          const base = { studentId: a.student_id, schoolId: s?.school_id ?? null, name: s?.full_name ?? 'Student', changed: false, skipped: false }
          if (a.shift_period !== 'afternoon') rows.morning.push({ ...base, time: a.pickup_time })
          if (a.shift_period !== 'morning') rows.afternoon.push({ ...base, time: a.dropoff_time })
        }
      }
      rows.morning.sort(byTime)
      rows.afternoon.sort(byTime)
      return {
        key,
        day: date.toLocaleDateString(undefined, { weekday: 'long' }),
        date: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        isToday,
        isPast: key < todayKey,
        workedThatDay: worked.has(key),
        rows,
        strips,
      }
    })
  }, [assignments, details, scheduleQuery.data, sessions, todayKey])

  const weekLabel = useMemo(() => {
    const mon = mondayOf(new Date())
    const fri = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 4)
    const md = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return mon.getMonth() === fri.getMonth() ? `${md(mon)} – ${fri.getDate()}` : `${md(mon)} – ${md(fri)}`
  }, [])

  return (
    <>
      <SectionHeader title="This week" aside={weekLabel} />
      <div className="mx-4 mb-2 flex gap-2 rounded-row bg-info-bg px-3 py-2 text-[12px] text-info-fg">
        <span className="material-symbols-outlined !text-[16px]">info</span>
        <span>Other days show your usual schedule. Late starts, early release and skips only show up on the day.</span>
      </div>
      <div className="mx-4 flex flex-col gap-2">
        {days.map((d) => {
          const open = openDay === d.key
          const total = { morning: d.rows.morning.length, afternoon: d.rows.afternoon.length }
          return (
            <div key={d.key} className={`overflow-hidden rounded-m border bg-surface ${d.isToday ? 'border-ink' : 'border-line'}`}>
              <button
                type="button"
                onClick={() => setOpenDay(open ? null : d.key)}
                aria-expanded={open}
                className="flex w-full cursor-pointer items-center gap-3 px-3.5 py-3 text-left"
              >
                <span className="flex flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-[14px] font-semibold text-ink">
                    {d.day}
                    <span className="font-normal text-muted">{d.date}</span>
                    {d.isToday && <span className="rounded-[5px] bg-next-bg px-1.5 py-px text-[11px] font-semibold text-next-fg">Today</span>}
                    {d.isPast && d.workedThatDay && (
                      <span className="material-symbols-outlined !text-[16px] text-success-fg" aria-label="Worked">
                        check_circle
                      </span>
                    )}
                  </span>
                  <span className="text-[12px] text-muted">
                    Morning {total.morning} · Afternoon {total.afternoon}
                  </span>
                </span>
                <span className="material-symbols-outlined !text-[20px] text-muted">{open ? 'expand_less' : 'expand_more'}</span>
              </button>
              {d.strips.map((s, i) => (
                <div
                  key={i}
                  className={`mx-3.5 mb-2 rounded-[6px] px-[9px] py-1.5 text-[12px] font-medium ${
                    s.tone === 'alert' ? 'bg-alert-bg text-alert-fg' : s.tone === 'info' ? 'bg-info-bg text-info-fg' : 'bg-caution-bg text-caution-fg'
                  }`}
                >
                  {s.text}
                </div>
              ))}
              {open && (
                <div className="flex flex-col gap-2.5 border-t border-divider px-3.5 pt-2.5 pb-3">
                  {(['morning', 'afternoon'] as const).map((period) => (
                    <div key={period} className="flex flex-col gap-1">
                      <span className="text-[12px] font-semibold text-muted">
                        {period === 'morning' ? 'Morning' : 'Afternoon'}
                        {range(d.rows[period]) ? ` · ${range(d.rows[period])}` : ''}
                      </span>
                      {d.rows[period].length === 0 ? (
                        <span className="py-1 text-[13px] text-faint">No students</span>
                      ) : (
                        d.rows[period].map((r) => (
                          <button
                            key={r.studentId + period}
                            type="button"
                            disabled={!r.schoolId}
                            onClick={() =>
                              r.schoolId &&
                              setSheet({ studentId: r.studentId, schoolId: r.schoolId, period, time: r.time, parentSkipped: d.isToday && r.skipped })
                            }
                            className={`flex cursor-pointer justify-between py-1 text-left text-[13px] text-ink ${r.skipped ? 'line-through opacity-60' : ''}`}
                          >
                            <span>{r.name}</span>
                            <span className={`tabular ${r.changed ? 'font-semibold text-caution-fg' : 'text-muted'}`}>
                              {r.time ? formatTimeOfDay(r.time) : '—'}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {sheet && <StudentSheet target={sheet} onClose={() => setSheet(null)} />}
    </>
  )
}
