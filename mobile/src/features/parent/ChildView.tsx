import { useState, type ReactNode } from 'react'
import { View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type {
  ParentStudentDetail,
  ParentTransportEntry,
  SkipPickupResponse,
  SkipStatus,
  Student,
} from '@/api/types'
import { Avatar } from '@/components/Avatar'
import { Button } from '@/components/Button'
import { CallButton } from '@/components/CallButton'
import { Card, KeyValueRow } from '@/components/Card'
import { ComingSoonRow, ConfirmCard } from '@/components/Dialogs'
import { Icon } from '@/components/Icon'
import { Screen } from '@/components/Screen'
import { ActionError, ErrorState, Loading, messageFor } from '@/components/States'
import { Banner } from '@/components/StatusBadge'
import { Text } from '@/components/Text'
import { firstName, formatClock, formatTimeOfDay } from '@/lib/format'
import { radius, type ToneName } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

// One child's day (design 5b). The design's "Van 04 is 3 stops away" banner and its live map
// need stop progress and GPS that do not exist yet (V2_ROADMAP.md), so the banner shows only
// what is actually known — skipped, dropped at school, arrived, dropped off home, or the next
// pickup time — and a "Live location and ETA" row opens the Coming soon dialog.
export function ChildView({ student, chips }: { student: Student; chips: ReactNode }) {
  const colors = useColors()
  const queryClient = useQueryClient()

  const detailQuery = useQuery({
    queryKey: ['parent-student-detail', student.id],
    queryFn: () => api.get<ParentStudentDetail>(`/parent/students/${student.id}/detail`),
  })

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['parent-student-detail', student.id] })
    void queryClient.invalidateQueries({ queryKey: ['skip-status', student.id] })
  }

  const d = detailQuery.data

  if (detailQuery.isLoading) {
    return (
      <Screen>
        {chips}
        <Loading />
      </Screen>
    )
  }

  if (!d) {
    return (
      <Screen refreshing={detailQuery.isFetching} onRefresh={refresh}>
        {chips}
        <View style={{ paddingTop: 16 }}>
          <ErrorState error={detailQuery.error} onRetry={refresh} />
        </View>
      </Screen>
    )
  }

  const transport = d.transport
  // Today's times come only from rides that run on today's weekday (runs_today); the driver
  // cards still show every ride. A 'both' assignment covers each shift; a split child has one
  // entry per shift.
  const today = transport.filter((t) => t.runs_today !== false)
  const noRideToday = transport.length > 0 && today.length === 0
  const morning = today.find((t) => t.shift_period !== 'afternoon')
  const afternoon = today.find((t) => t.shift_period !== 'morning')
  const pickupTrip = d.trips_today.find((t) => t.trip_type === 'pickup')
  const dropoffTrip = d.trips_today.find((t) => t.trip_type === 'dropoff')

  // What we honestly know about today, most recent thing first.
  let banner: { toneName: ToneName; icon: 'event-busy' | 'home' | 'school' | 'directions-bus' | 'no-transfer' | 'wb-sunny' | 'schedule'; text: string } | null
  if (d.skip_today) {
    banner = { toneName: 'info', icon: 'event-busy', text: 'Morning pickup skipped today' }
  } else if (dropoffTrip) {
    banner = { toneName: 'success', icon: 'home', text: `Dropped off at ${formatClock(dropoffTrip.created_at)}` }
  } else if (pickupTrip?.status === 'complete') {
    banner = {
      toneName: 'success',
      icon: 'school',
      text: `Arrived at school ${formatClock(pickupTrip.completed_at ?? pickupTrip.created_at)}`,
    }
  } else if (pickupTrip) {
    banner = {
      toneName: 'caution',
      icon: 'directions-bus',
      text: `Dropped at school ${formatClock(pickupTrip.created_at)}, waiting for the school to confirm`,
    }
  } else if (transport.length === 0) {
    banner = { toneName: 'neutral', icon: 'no-transfer', text: 'No ride set up yet' }
  } else if (noRideToday) {
    banner = { toneName: 'neutral', icon: 'event-busy', text: 'No ride today' }
  } else if (!morning) {
    banner = { toneName: 'neutral', icon: 'wb-sunny', text: 'Afternoon ride only' }
  } else if (morning.pickup_time) {
    banner = { toneName: 'neutral', icon: 'schedule', text: `Pickup at ${formatTimeOfDay(morning.pickup_time)}` }
  } else {
    banner = null
  }

  const rows = [
    {
      label: 'Morning pickup',
      value: d.skip_today
        ? 'Skipped today'
        : morning
          ? `${formatTimeOfDay(morning.pickup_time)} · Home`
          : noRideToday
            ? 'No ride today'
            : 'No ride',
    },
    {
      label: 'Arrives at school',
      value:
        pickupTrip?.status === 'complete'
          ? `${formatClock(pickupTrip.completed_at ?? pickupTrip.created_at)} · ${d.school.name ?? 'School'}`
          : (d.school.name ?? '—'),
    },
    {
      label: 'Afternoon drop-off',
      value: afternoon ? `${formatTimeOfDay(afternoon.dropoff_time)} · Home` : noRideToday ? 'No ride today' : 'No ride',
    },
  ]

  // One driver card per distinct driver — a split child can have two.
  const drivers = transport.filter(
    (t, i) => t.driver && transport.findIndex((x) => x.driver?.full_name === t.driver?.full_name) === i,
  )

  return (
    <SkipBarScreen student={student} detail={d} onRefresh={refresh} refreshing={detailQuery.isFetching}>
      {chips}
      <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16, gap: 12 }}>
        <View>
          <Text size={18} weight="semibold">
            {student.full_name}
          </Text>
          <Text size={13} color={colors.muted}>
            {[student.grade ? `Grade ${student.grade}` : null, d.school.name].filter(Boolean).join(' · ')}
          </Text>
        </View>
        {banner ? (
          <Banner
            toneName={banner.toneName}
            label={banner.text}
            icon={<Icon name={banner.icon} size={18} color={colors.ink} />}
          />
        ) : null}
        {transport.length > 0 ? (
          <ComingSoonRow icon="near-me" label="Live location and ETA" feature="Live van tracking" />
        ) : null}
      </Card>

      <Card style={{ marginHorizontal: 16, marginTop: 12 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          <Text size={13} weight="semibold">
            Today
          </Text>
        </View>
        {rows.map((r, i) => (
          <KeyValueRow key={r.label} label={r.label} value={r.value} first={i === 0} />
        ))}
      </Card>

      {drivers.length === 0 ? (
        <Card style={{ marginHorizontal: 16, marginTop: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text size={13} color={colors.muted}>
            No driver assigned yet.{d.company.name ? ` ${d.company.name} sets this up.` : ''}
          </Text>
        </Card>
      ) : (
        drivers.map((t, i) => <DriverCard key={i} entry={t} labelShift={drivers.length > 1} />)
      )}
    </SkipBarScreen>
  )
}

function DriverCard({ entry, labelShift }: { entry: ParentTransportEntry; labelShift: boolean }) {
  const colors = useColors()
  const v = entry.van
  const driver = entry.driver!
  return (
    <Card
      style={{
        marginHorizontal: 16,
        marginTop: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
      }}
    >
      <Avatar name={driver.full_name} size={44} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text size={15} weight="semibold" numberOfLines={1}>
          {driver.full_name}
          {labelShift ? (
            <Text size={12} color={colors.muted}>
              {` · ${entry.shift_period === 'afternoon' ? 'Afternoon' : 'Morning'}`}
            </Text>
          ) : null}
        </Text>
        <Text size={12} color={colors.muted} numberOfLines={1}>
          {v
            ? [
                v.number ? `Van ${v.number}` : null,
                [v.color, v.brand, v.model].filter(Boolean).join(' '),
                v.license_plate,
              ]
                .filter(Boolean)
                .join(' · ')
            : 'No van on file'}
        </Text>
      </View>
      {driver.phone ? <CallButton phone={driver.phone} primary label={`Call ${driver.full_name}`} /> : null}
    </Card>
  )
}

// The thumb bar holds "Skip today's pickup" (design 5b). Eligibility is entirely the server's
// call: GET /skip-status decides, and its `reason` is what the parent is told. A split child
// (separate morning and afternoon assignments) chooses morning only or the whole day.
function SkipBarScreen({
  student,
  detail,
  children,
  onRefresh,
  refreshing,
}: {
  student: Student
  detail: ParentStudentDetail
  children: ReactNode
  onRefresh: () => void
  refreshing: boolean
}) {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<'single' | 'morning' | 'whole_day' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['skip-status', student.id],
    queryFn: () => api.get<SkipStatus>(`/parent/students/${student.id}/skip-status`),
  })
  const data = statusQuery.data

  const skip = useMutation({
    mutationFn: (shiftChoice?: 'morning' | 'whole_day') =>
      api.post<SkipPickupResponse>(
        `/parent/students/${student.id}/skip-pickup`,
        shiftChoice ? { shift_choice: shiftChoice } : undefined,
      ),
    // onSettled: the live API has saved a skip and then answered 500 (notification email
    // failed, see MOBILE_BACKEND_NEEDS.md), so reload after any outcome to show the truth.
    onSuccess: () => setError(null),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['skip-status', student.id] })
      void queryClient.invalidateQueries({ queryKey: ['parent-student-detail', student.id] })
    },
    // A 403 "too late to skip today's pickup" or a 409 "already skipped" arrives with a message
    // written for parents; show it as it is rather than guessing the rule here.
    onError: (err) => setError(messageFor(err, 'Could not skip the pickup.')),
  })

  const name = firstName(student.full_name)
  const hasMorning = detail.transport.some((t) => t.shift_period !== 'afternoon')
  const hasAfternoon = detail.transport.some((t) => t.shift_period !== 'morning')
  const caption = 'Available until the van leaves for your stop'

  let content: ReactNode
  if (statusQuery.isLoading) {
    content = <Loading label="Checking…" />
  } else if (!hasMorning) {
    content = (
      <Text size={13} color={colors.muted} style={{ textAlign: 'center', paddingVertical: 8 }}>
        {name} has no morning ride, so there&apos;s no pickup to skip.
      </Text>
    )
  } else if (data?.splitShift) {
    const { morningOnly, wholeDay } = data
    if (morningOnly.alreadySkipped || wholeDay.alreadySkipped) {
      content = (
        <Text size={13} color={colors.muted} style={{ textAlign: 'center', paddingVertical: 8 }}>
          {wholeDay.alreadySkipped
            ? 'Skipped for the whole day.'
            : 'Morning skipped. Afternoon drop-off is unchanged.'}
        </Text>
      )
    } else {
      content = (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              label="Skip morning"
              variant="outline"
              disabled={!morningOnly.eligible || skip.isPending}
              onPress={() => setPending('morning')}
              style={{ flex: 1 }}
            />
            <Button
              label="Skip whole day"
              variant="outline"
              disabled={!wholeDay.eligible || skip.isPending}
              onPress={() => setPending('whole_day')}
              style={{ flex: 1 }}
            />
          </View>
          <Text size={12} color={colors.muted} style={{ textAlign: 'center' }}>
            {caption}
          </Text>
        </>
      )
    }
  } else {
    const status = data && data.splitShift === false ? data : null
    if (detail.skip_today || status?.alreadySkipped) {
      content = (
        <Text size={13} color={colors.muted} style={{ textAlign: 'center', paddingVertical: 8 }}>
          Skipped.{hasAfternoon ? ' Afternoon drop-off is unchanged.' : ''}
        </Text>
      )
    } else {
      content = (
        <>
          <Button
            label="Skip today's pickup"
            icon="event-busy"
            variant="outline"
            busy={skip.isPending}
            busyLabel="Skipping…"
            disabled={!status?.eligible}
            onPress={() => setPending('single')}
          />
          <Text size={12} color={colors.muted} style={{ textAlign: 'center' }}>
            {status?.eligible ? caption : (status?.reason ?? caption)}
          </Text>
        </>
      )
    }
  }

  return (
    <>
      <Screen
        refreshing={refreshing}
        onRefresh={onRefresh}
        thumbBar={
          <>
            {error ? <ActionError message={error} /> : null}
            {content}
          </>
        }
      >
        {children}
        <View style={{ height: radius.card }} />
      </Screen>

      {pending ? (
        <ConfirmCard
          title={pending === 'whole_day' ? `Skip ${name}'s rides today?` : `Skip ${name}'s pickup today?`}
          body={
            pending === 'whole_day'
              ? 'Both the morning pickup and the afternoon drop-off are cancelled for today. The driver and the school are told.'
              : `The driver won't stop for ${name} this morning. The driver and the school are told.${
                  hasAfternoon ? ' Afternoon drop-off stays as usual.' : ''
                }`
          }
          cancelLabel="Keep pickup"
          confirmLabel={pending === 'whole_day' ? 'Skip whole day' : 'Skip pickup'}
          busy={skip.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            skip.mutate(pending === 'single' ? undefined : pending)
            setPending(null)
          }}
        />
      ) : null}
    </>
  )
}
