import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { DueItem, MaintenanceItem, Van, VanMaintenance } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, Divided, SectionHeader } from '@/components/Card'
import { inputStyle } from '@/components/Form'
import { Icon } from '@/components/Icon'
import { Screen } from '@/components/Screen'
import { ActionError, ErrorState, Loading, messageFor } from '@/components/States'
import { StatusBadge } from '@/components/StatusBadge'
import { Text } from '@/components/Text'
import { WebsiteRow } from '@/features/admin/components'
import { WEBSITE_PAGES } from '@/features/admin/logic'
import { dueLine, milesText, stateBadge } from '@/features/fleet/text'
import { vanName } from '@/lib/fleet'
import { useColors } from '@/theme/theme'

// Company admin, Fleet tab (branch van-maintenance): what is overdue and due soon across the vans,
// each van's items, and "Done" (kept in the history; the next cycle starts from the odometer or
// the date). Setting dates and targets, custom items, reminder timing and fuel fixes are on the
// website (link below), like the other admin edits.
export default function FleetScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const due = useQuery({ queryKey: ['fleet', 'due'], queryFn: () => api.get<{ overdue: DueItem[]; due_soon: DueItem[] }>('/fleet/due') })
  const vans = useQuery({ queryKey: ['vans'], queryFn: () => api.get<Van[]>('/vans') })
  const [openVan, setOpenVan] = useState<string | null>(null)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['fleet'] })

  if (due.isLoading) {
    return (
      <Screen>
        <Loading label="Loading the fleet…" />
      </Screen>
    )
  }
  if (due.error) {
    return (
      <Screen onRefresh={refresh}>
        <ErrorState error={due.error} onRetry={refresh} />
      </Screen>
    )
  }
  const rows = [...(due.data?.overdue ?? []), ...(due.data?.due_soon ?? [])]

  return (
    <Screen refreshing={due.isFetching} onRefresh={refresh}>
      <SectionHeader title="Maintenance due" aside={`${due.data?.overdue.length ?? 0} overdue · ${due.data?.due_soon.length ?? 0} soon`} />
      <Card style={{ marginHorizontal: 16 }}>
        {rows.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            Nothing due soon.
          </Text>
        ) : (
          rows.map((i, n) => (
            <Divided key={i.id} first={n === 0}>
              <ItemRow vanId={i.van_id} item={i} title={`${i.van_label} · ${i.name}`} currentMiles={i.current_miles} />
            </Divided>
          ))
        )}
      </Card>

      <SectionHeader title="Vans" />
      <Card style={{ marginHorizontal: 16 }}>
        {(vans.data ?? []).map((v, n) => (
          <Divided key={v.id} first={n === 0}>
            <Pressable
              onPress={() => setOpenVan(openVan === v.id ? null : v.id)}
              accessibilityRole="button"
              accessibilityState={{ expanded: openVan === v.id }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14 }}
            >
              <Icon name="airport-shuttle" size={20} color={colors.muted} />
              <Text size={15} weight="medium" style={{ flex: 1 }}>
                {vanName(v)} · {v.license_plate}
              </Text>
              <Icon name={openVan === v.id ? 'expand-less' : 'expand-more'} size={22} color={colors.muted} />
            </Pressable>
            {openVan === v.id ? <VanItems vanId={v.id} /> : null}
          </Divided>
        ))}
      </Card>

      <View style={{ marginHorizontal: 16, marginTop: 12 }}>
        <WebsiteRow label="Set dates, add items, reminder timing and fuel log" path={WEBSITE_PAGES.fleet} />
      </View>
    </Screen>
  )
}

function VanItems({ vanId }: { vanId: string }) {
  const colors = useColors()
  const q = useQuery({ queryKey: ['fleet', 'van', vanId], queryFn: () => api.get<VanMaintenance>(`/fleet/vans/${vanId}/maintenance`) })
  if (q.isLoading) {
    return (
      <Text size={13} color={colors.muted} style={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        Loading…
      </Text>
    )
  }
  if (!q.data) return null
  return (
    <View style={{ paddingBottom: 6 }}>
      <Text size={13} color={colors.muted} style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
        Odometer: {milesText(q.data.current_miles)}
      </Text>
      {q.data.items.map((i) => (
        <ItemRow key={i.id} vanId={vanId} item={i} title={i.name} currentMiles={q.data.current_miles} indent />
      ))}
    </View>
  )
}

function ItemRow({
  vanId,
  item,
  title,
  currentMiles,
  indent = false,
}: {
  vanId: string
  item: MaintenanceItem
  title: string
  currentMiles: number | null
  indent?: boolean
}) {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [doing, setDoing] = useState(false)
  const [odometer, setOdometer] = useState(currentMiles === null ? '' : String(currentMiles))
  const [error, setError] = useState<string | null>(null)
  const badge = stateBadge(item)
  const done = useMutation({
    mutationFn: () => api.post(`/fleet/vans/${vanId}/maintenance/${item.id}/done`, { odometer: odometer.trim() === '' ? null : Number(odometer) }),
    onMutate: () => setError(null),
    onSuccess: () => {
      setDoing(false)
      void queryClient.invalidateQueries({ queryKey: ['fleet'] })
    },
    onError: (err) => setError(messageFor(err, 'Could not save.')),
  })
  return (
    <View style={{ paddingHorizontal: indent ? 24 : 16, paddingVertical: 10, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text size={14} weight="medium">
            {title}
          </Text>
          <Text size={13} color={colors.muted}>
            {dueLine(item)}
          </Text>
        </View>
        {badge ? <StatusBadge label={badge.label} toneName={badge.tone} /> : null}
        {item.is_active && !doing ? <Button label="Done" compact variant="outline" onPress={() => setDoing(true)} /> : null}
      </View>
      {doing ? (
        <View style={{ gap: 8 }}>
          <Text size={13} color={colors.muted}>
            {item.schedule_type === 'mileage' ? 'Odometer now (miles): the next target starts from it.' : 'Odometer now (miles), for the record.'}
          </Text>
          <TextInput
            value={odometer}
            onChangeText={setOdometer}
            keyboardType="number-pad"
            style={inputStyle(colors.ink, colors.line, colors.surface)}
            accessibilityLabel="Odometer miles"
          />
          {error ? <ActionError message={error} /> : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Cancel" compact variant="outline" style={{ flex: 1 }} onPress={() => setDoing(false)} />
            <Button label="Mark done" compact style={{ flex: 1 }} busy={done.isPending} onPress={() => done.mutate()} />
          </View>
        </View>
      ) : null}
    </View>
  )
}
