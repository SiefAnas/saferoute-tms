import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { Card, Divided, SectionHeader } from '@/components/Card'
import { DifferentAddressNote, homeEnd, isDifferent, legOf, placeName } from '@/components/Route'
import { Icon, type IconName } from '@/components/Icon'
import { Screen } from '@/components/Screen'
import { ErrorState, Loading } from '@/components/States'
import { StatusBadge, type ToneName } from '@/components/StatusBadge'
import { Text } from '@/components/Text'
import type { ShiftPeriod, TodayScheduleItem, WeekScheduleDay } from '@/api/types'
import { formatTimeOfDay } from '@/lib/format'
import { addDaysISO, localDateOf, localISODate, mondayOf } from '@/lib/localDate'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { useWeekSchedule } from '@/features/driver/data'

// Week tab: the real week from GET /schedule/week (Monday to Sunday), a card per day with the
// morning pickups and afternoon drop-offs, that day's time changes and notes, parent skips and
// no-shows. Previous / next move a week at a time. Dates stay "YYYY-MM-DD" strings
// (lib/localDate.ts), never toISOString(). Same data and rules as the web Week tab.
export default function WeekScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const thisWeek = mondayOf()
  const [start, setStart] = useState(thisWeek)
  const weekQuery = useWeekSchedule(start)
  const today = localISODate()
  const shortDate = (iso: string) => localDateOf(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const range = `${shortDate(start)} – ${shortDate(addDaysISO(start, 6))}`
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['schedule-week', start] })

  return (
    <Screen refreshing={weekQuery.isFetching && !weekQuery.isLoading} onRefresh={refresh}>
      <SectionHeader title={start === thisWeek ? 'This week' : 'Week'} aside={range} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12 }}>
        <WeekButton icon="chevron-left" label="Previous week" onPress={() => setStart(addDaysISO(start, -7))} />
        <WeekButton icon="chevron-right" label="Next week" onPress={() => setStart(addDaysISO(start, 7))} />
        {start !== thisWeek ? (
          <Pressable
            onPress={() => setStart(thisWeek)}
            accessibilityRole="button"
            style={{
              height: 44,
              paddingHorizontal: 14,
              justifyContent: 'center',
              borderRadius: radius.button,
              borderWidth: 1,
              borderColor: colors.line,
              backgroundColor: colors.surface,
            }}
          >
            <Text size={14} weight="medium">
              This week
            </Text>
          </Pressable>
        ) : null}
      </View>

      {weekQuery.isLoading ? (
        <Loading />
      ) : weekQuery.error || !weekQuery.data ? (
        <ErrorState error={weekQuery.error} onRetry={refresh} />
      ) : (
        <View style={{ gap: 12, marginHorizontal: 16 }}>
          {weekQuery.data.days.map((d) => (
            <DayCard key={d.date} day={d} isToday={d.date === today} />
          ))}
        </View>
      )}
    </Screen>
  )
}

function WeekButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  const colors = useColors()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.button,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <Icon name={icon} size={24} color={colors.ink} />
    </Pressable>
  )
}

function DayCard({ day, isToday }: { day: WeekScheduleDay; isToday: boolean }) {
  const colors = useColors()
  const date = localDateOf(day.date)
  const empty = day.morning.length === 0 && day.afternoon.length === 0
  return (
    <Card style={isToday ? { borderColor: colors.action } : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
        <Text size={15} weight="semibold">
          {date.toLocaleDateString(undefined, { weekday: 'long' })}
          <Text size={15} color={colors.muted}>
            {' · '}
            {date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
        </Text>
        {isToday ? <StatusBadge label="Today" toneName="next" /> : null}
      </View>
      {empty ? (
        <Text size={13} color={colors.muted} style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
          No runs
        </Text>
      ) : (
        <>
          <Run period="morning" items={day.morning} />
          <Run period="afternoon" items={day.afternoon} />
        </>
      )}
    </Card>
  )
}

function Run({ period, items }: { period: ShiftPeriod; items: TodayScheduleItem[] }) {
  const colors = useColors()
  if (items.length === 0) return null
  const rows = items
    .map((item) => {
      const usual = period === 'morning' ? item.pickup_time : item.dropoff_time
      const changed = period === 'morning' ? item.override?.pickup_time : item.override?.dropoff_time
      return { item, time: changed ?? usual, timeChanged: Boolean(changed) && changed !== usual }
    })
    .sort((a, b) => (a.time ?? '99').localeCompare(b.time ?? '99') || a.item.student.name.localeCompare(b.item.student.name))
  return (
    <Divided first={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 }}>
        <Icon name={period === 'morning' ? 'wb-twilight' : 'wb-sunny'} size={16} color={colors.muted} />
        <Text size={12} weight="semibold" color={colors.muted}>
          {period === 'morning' ? 'Morning pickups' : 'Afternoon drop-offs'} · {items.length}
        </Text>
      </View>
      {rows.map(({ item, time, timeChanged }) => {
        const status = statusOf(item, period)
        return (
          <View
            key={item.assignment_id}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8, opacity: status ? 0.7 : 1 }}
          >
            <Text
              size={12}
              tabular
              weight={timeChanged ? 'semibold' : 'regular'}
              color={timeChanged ? colors.cautionFg : colors.muted}
              style={{ width: 62 }}
            >
              {time ? formatTimeOfDay(time) : '—'}
            </Text>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text size={14} weight="medium" numberOfLines={1}>
                {item.student.name}
              </Text>
              {isDifferent(legOf(item.route, period)) ? (
                <DifferentAddressNote compact place={homeEnd(legOf(item.route, period)!, period)} />
              ) : null}
              <Text size={12} color={colors.muted} numberOfLines={1}>
                {placeName(legOf(item.route, period)?.from)} → {placeName(legOf(item.route, period)?.to)}
                {item.override?.note ? ` · ${item.override.note}` : ''}
              </Text>
            </View>
            {status ? <StatusBadge label={status.label} toneName={status.toneName} /> : null}
          </View>
        )
      })}
    </Divided>
  )
}

function statusOf(item: TodayScheduleItem, period: ShiftPeriod): { toneName: ToneName; label: string } | null {
  if (item.no_show_reported[period]) return { toneName: 'alert', label: 'No-show' }
  if (item.parent_skipped[period]) return { toneName: 'info', label: 'Parent skipped' }
  if (item.override?.skip) return { toneName: 'info', label: 'No ride' }
  return null
}
