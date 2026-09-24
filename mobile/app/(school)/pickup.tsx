import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { AbsentTodayEntry, Student, Trip } from '@/api/types'
import { Button } from '@/components/Button'
import { CallButton } from '@/components/CallButton'
import { Card, SectionHeader } from '@/components/Card'
import { Screen } from '@/components/Screen'
import { ActionError, ErrorState, Loading, messageFor } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Text } from '@/components/Text'
import { PersonRow, StatTile } from '@/features/admin/components'
import { absentLabel, todaysTrips } from '@/features/admin/logic'
import { formatClock } from '@/lib/format'
import { useColors } from '@/theme/theme'

// School admin / staff, Pickup tab: today's trips for the school's students (staff: only the
// students granted to them; the server decides). "Confirm" marks a student received, like the
// website's Pickup & drop-off page. Trips auto-complete 5 minutes after the driver confirms.
export default function SchoolPickupScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const tripsQuery = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/trips') })
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const absentQuery = useQuery({ queryKey: ['dashboard-absent-today'], queryFn: () => api.get<AbsentTodayEntry[]>('/dashboard/absent-today') })

  const names = useMemo(() => new Map((studentsQuery.data ?? []).map((s) => [s.id, s.full_name])), [studentsQuery.data])
  const trips = useMemo(() => todaysTrips(tripsQuery.data ?? []), [tripsQuery.data])
  const waiting = trips.filter((t) => t.status === 'pending')
  const confirmed = trips.filter((t) => t.status === 'complete')
  const absent = absentQuery.data ?? []

  const confirm = useMutation({
    mutationFn: (trip: Trip) => api.post<Trip>(`/trips/${trip.id}/confirm`),
    onMutate: () => setError(null),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['trips'] }),
    onError: (err) => setError(messageFor(err, 'Could not confirm.')),
  })
  const refresh = () => {
    for (const key of [['trips'], ['students'], ['dashboard-absent-today']]) void queryClient.invalidateQueries({ queryKey: key })
  }

  if (tripsQuery.isLoading || studentsQuery.isLoading) {
    return (
      <Screen>
        <Loading label="Loading today's trips…" />
      </Screen>
    )
  }
  const failed = tripsQuery.error ?? studentsQuery.error
  if (failed) {
    return (
      <Screen onRefresh={refresh}>
        <ErrorState error={failed} onRetry={refresh} />
      </Screen>
    )
  }

  const tripLine = (t: Trip) =>
    [t.trip_type === 'pickup' ? 'Pickup' : 'Drop-off', t.driver_name ? `driver ${t.driver_name}` : null, formatClock(t.created_at)].filter(Boolean).join(' · ')

  return (
    <Screen refreshing={tripsQuery.isFetching} onRefresh={refresh}>
      <SectionHeader title="Pickup and drop-off" />
      <View style={{ marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <StatTile label="Waiting on you" value={waiting.length} sub="tap Confirm as each arrives" tone={waiting.length ? 'caution' : undefined} />
        <StatTile label="Confirmed today" value={confirmed.length} tone={confirmed.length ? 'success' : undefined} />
      </View>
      {error ? (
        <View style={{ marginHorizontal: 16, marginTop: 12 }}>
          <ActionError message={error} />
        </View>
      ) : null}

      <SectionHeader title="Waiting on you" aside={`${waiting.length}`} />
      <Card style={{ marginHorizontal: 16 }}>
        {waiting.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            Nothing waiting. When a driver drops a student off or picks one up, it shows here.
          </Text>
        ) : (
          waiting.map((t, i) => (
            <View
              key={t.id}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text size={15} weight="semibold" numberOfLines={1}>
                  {names.get(t.student_id) ?? 'Student'}
                </Text>
                <Text size={12} color={colors.muted} numberOfLines={1}>
                  {tripLine(t)}
                </Text>
              </View>
              {t.driver_phone ? <CallButton phone={t.driver_phone} label={`Call ${t.driver_name ?? 'the driver'}`} /> : null}
              <Button label="Confirm" compact busy={confirm.isPending && confirm.variables?.id === t.id} busyLabel="…" onPress={() => confirm.mutate(t)} />
            </View>
          ))
        )}
      </Card>

      <SectionHeader title="Absent today" aside={`${absent.length}`} />
      <Card style={{ marginHorizontal: 16 }}>
        {absent.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            No skips or no-shows today.
          </Text>
        ) : (
          absent.map((e, i) => (
            <PersonRow key={`${e.student_id}-${e.type}`} first={i === 0} name={e.student_name} sub={formatClock(e.at)} badge={{ label: absentLabel(e), tone: e.type === 'parent_skipped' ? 'info' : 'alert' }} />
          ))
        )}
      </Card>

      <SectionHeader title="Confirmed today" aside={`${confirmed.length}`} />
      <Card style={{ marginHorizontal: 16 }}>
        {confirmed.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            None yet.
          </Text>
        ) : (
          confirmed.map((t, i) => (
            <View
              key={t.id}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.divider }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <Text size={15} weight="medium" numberOfLines={1}>
                  {names.get(t.student_id) ?? 'Student'}
                </Text>
                <Text size={12} color={colors.muted} numberOfLines={1}>
                  {tripLine(t)}
                </Text>
              </View>
              <StatusBadge label={t.auto_completed ? 'Auto-confirmed' : 'Confirmed'} toneName="success" />
            </View>
          ))
        )}
      </Card>
    </Screen>
  )
}
