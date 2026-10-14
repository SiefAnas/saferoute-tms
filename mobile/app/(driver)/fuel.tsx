import { useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { FuelEntry, MyFuel } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, Divided, SectionHeader } from '@/components/Card'
import { Field, inputStyle } from '@/components/Form'
import { Screen } from '@/components/Screen'
import { ActionError, EmptyState, ErrorState, Loading, messageFor } from '@/components/States'
import { Text } from '@/components/Text'
import { fuelBody, milesText, shortDate } from '@/features/fleet/text'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'

// Driver app, Fuel tab (branch van-maintenance): the odometer reading (required) and, after a fill
// up, gallons and cost (optional). The newest reading keeps the van's oil changes and other
// mileage items on time. The office fixes mistakes; a driver only adds. Same as the website.
export default function FuelScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const q = useQuery({ queryKey: ['fleet', 'mine'], queryFn: () => api.get<MyFuel>('/fleet/fuel/mine') })
  const [vanId, setVanId] = useState<string | null>(null)
  const [miles, setMiles] = useState('')
  const [gallons, setGallons] = useState('')
  const [cost, setCost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const input = inputStyle(colors.ink, colors.line, colors.surface)
  const vans = q.data?.vans ?? []
  const van = vans.find((v) => v.id === vanId) ?? vans[0]

  const add = useMutation({
    mutationFn: (body: Record<string, number | null>) => api.post<FuelEntry>('/fleet/fuel', { van_id: van?.id, ...body }),
    onMutate: () => {
      setError(null)
      setSaved(null)
    },
    onSuccess: (e) => {
      setSaved(`Saved: ${e.miles.toLocaleString('en-US')} miles.`)
      setMiles('')
      setGallons('')
      setCost('')
      void queryClient.invalidateQueries({ queryKey: ['fleet', 'mine'] })
    },
    onError: (err) => setError(messageFor(err, 'Could not save. Try again.')),
  })

  function save() {
    const parsed = fuelBody(miles, gallons, cost)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    add.mutate(parsed.body)
  }

  if (q.isLoading) {
    return (
      <Screen>
        <Loading label="Loading your van…" />
      </Screen>
    )
  }
  if (q.error) {
    return (
      <Screen onRefresh={() => void q.refetch()}>
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      </Screen>
    )
  }

  return (
    <Screen refreshing={q.isFetching} onRefresh={() => void q.refetch()}>
      <SectionHeader title="Fuel and odometer" />
      {vans.length === 0 ? (
        <EmptyState icon="local-gas-station" title="No van assigned" body="You have no van assigned, so there is nothing to enter." />
      ) : (
        <Card style={{ marginHorizontal: 16, padding: 16, gap: 12 }}>
          {vans.length > 1 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {vans.map((v) => {
                const on = v.id === van?.id
                return (
                  <Pressable
                    key={v.id}
                    onPress={() => setVanId(v.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.row, borderWidth: 1, borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.surface2 : colors.surface }}
                  >
                    <Text size={14} weight={on ? 'semibold' : 'regular'}>
                      {v.label}
                    </Text>
                  </Pressable>
                )
              })}
            </View>
          ) : null}
          <Text size={14} color={colors.muted}>
            {van?.label} · {van?.current_miles !== null && van?.current_miles !== undefined ? `last reading ${milesText(van.current_miles)}` : 'no reading yet'}
          </Text>
          <Field label="Odometer (miles)">
            <TextInput value={miles} onChangeText={setMiles} keyboardType="number-pad" placeholder="e.g. 45210" placeholderTextColor={colors.faint} style={input} accessibilityLabel="Odometer miles" />
          </Field>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Field label="Gallons (optional)">
                <TextInput value={gallons} onChangeText={setGallons} keyboardType="decimal-pad" placeholderTextColor={colors.faint} style={input} accessibilityLabel="Gallons" />
              </Field>
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Cost $ (optional)">
                <TextInput value={cost} onChangeText={setCost} keyboardType="decimal-pad" placeholderTextColor={colors.faint} style={input} accessibilityLabel="Cost in dollars" />
              </Field>
            </View>
          </View>
          {error ? <ActionError message={error} /> : null}
          {saved ? (
            <Text size={14} color={colors.successFg}>
              {saved}
            </Text>
          ) : null}
          <Button label="Save reading" icon="local-gas-station" busy={add.isPending} busyLabel="Saving…" disabled={!miles.trim()} onPress={save} />
        </Card>
      )}

      {(q.data?.entries ?? []).length > 0 ? (
        <>
          <SectionHeader title="Recent" />
          <Card style={{ marginHorizontal: 16 }}>
            {(q.data?.entries ?? []).map((e, i) => (
              <Divided key={e.id} first={i === 0}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
                  <Text size={14} weight="medium" tabular>
                    {milesText(e.miles)}
                  </Text>
                  <Text size={13} color={colors.muted}>
                    {[shortDate(e.entry_date), e.gallons !== null ? `${e.gallons} gal` : null, e.cost !== null ? `$${e.cost.toFixed(2)}` : null].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Divided>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  )
}
