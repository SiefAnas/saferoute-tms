import { useMemo } from 'react'
import { View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { Card, Divided, SectionHeader } from '@/components/Card'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Loading } from '@/components/States'
import { StatusBadge, type ToneName } from '@/components/StatusBadge'
import { Text } from '@/components/Text'
import { formatClock, formatTimeOfDay } from '@/lib/format'
import { useColors } from '@/theme/theme'
import { useTodaySchedule, useTodaysTrips } from '@/features/driver/data'

interface Row {
  key: string
  time: string
  sortKey: string
  name: string
  kind: string
  label: string
  toneName: ToneName
}

// Today's instant for a "HH:MM:SS" scheduled time, so scheduled times sort alongside the real
// timestamps on logged trips.
function todayAt(time: string): string {
  const parts = time.split(':')
  const d = new Date()
  d.setHours(Number(parts[0] ?? 0), Number(parts[1] ?? 0), 0, 0)
  return d.toISOString()
}

// Driver app, Trips tab (design 3a): today's logged pickups and drop-offs, plus the no-shows
// the driver reported. Trips come from GET /trips; a no-show has no row in that list, so it
// comes from today's schedule flags and shows at its scheduled time.
export default function TripsScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const router = useRouter()
  const { query: tripsQuery, today } = useTodaysTrips()
  const scheduleQuery = useTodaySchedule()

  const rows = useMemo(() => {
    const items = scheduleQuery.data ?? []
    const nameOf = new Map(items.map((i) => [i.student.id, i.student.name]))
    const out: Row[] = today.map((t) => ({
      key: t.id,
      time: formatClock(t.created_at),
      sortKey: t.created_at,
      name: nameOf.get(t.student_id) ?? 'Student',
      kind: t.trip_type === 'pickup' ? 'Pickup' : 'Drop-off',
      label: t.status === 'complete' ? 'Confirmed' : 'Awaiting school',
      toneName: t.status === 'complete' ? 'success' : 'caution',
    }))

    for (const i of items) {
      for (const period of ['morning', 'afternoon'] as const) {
        if (!i.no_show_reported[period]) continue
        const scheduled =
          period === 'morning'
            ? (i.override?.pickup_time ?? i.pickup_time)
            : (i.override?.dropoff_time ?? i.dropoff_time)
        out.push({
          key: `${i.assignment_id}-${period}-noshow`,
          time: scheduled ? formatTimeOfDay(scheduled) : '—',
          sortKey: scheduled ? todayAt(scheduled) : '',
          name: i.student.name,
          kind: 'No-show reported',
          label: 'No-show',
          toneName: 'alert',
        })
      }
    }
    return out.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
  }, [today, scheduleQuery.data])

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['trips'] })
    void queryClient.invalidateQueries({ queryKey: ['schedule-today'] })
  }

  return (
    <Screen refreshing={tripsQuery.isFetching || scheduleQuery.isFetching} onRefresh={refresh}>
      <SectionHeader title="Today's trips" aside={`${rows.length} ${rows.length === 1 ? 'trip' : 'trips'}`} />
      {tripsQuery.isLoading ? (
        <Loading />
      ) : tripsQuery.error && !tripsQuery.data ? (
        <ErrorState error={tripsQuery.error} onRetry={refresh} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="receipt-long"
          title="No trips yet today"
          body="Each pickup and drop-off you log lands here and waits for the school to confirm it."
          action={{ label: "Go to today's students", onPress: () => router.replace('/(driver)/today') }}
        />
      ) : (
        <Card style={{ marginHorizontal: 16 }}>
          {rows.map((r, i) => (
            <Divided key={r.key} first={i === 0}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 12,
                }}
              >
                <Text size={12} color={colors.muted} tabular style={{ width: 62 }}>
                  {r.time}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text size={14} weight="medium" numberOfLines={1}>
                    {r.name}
                  </Text>
                  <Text size={12} color={colors.muted}>
                    {r.kind}
                  </Text>
                </View>
                <StatusBadge label={r.label} toneName={r.toneName} />
              </View>
            </Divided>
          ))}
        </Card>
      )}
    </Screen>
  )
}
