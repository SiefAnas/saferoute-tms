import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { SigninReminderDriver, SigninReminderSettings } from '@/api/types'
import { Card } from '@/components/Card'
import { ActionError, messageFor } from '@/components/States'
import { Text } from '@/components/Text'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { SIGNIN_CHOICES, signinSummary } from './signinReminderText'

// Driver sign-in reminder settings (branch signin-reminder), same as the website's Drivers page:
// the company default (minutes before the first stop, or off) on the More tab, and each driver's
// own setting in their People sheet. Same query key as the website.
const KEY = ['signin-reminders']

export function useSigninReminders() {
  return useQuery({ queryKey: KEY, queryFn: () => api.get<SigninReminderSettings>('/signin-reminders') })
}

function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  const colors = useColors()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      style={{
        minHeight: 40,
        justifyContent: 'center',
        paddingHorizontal: 12,
        borderRadius: radius.row,
        borderWidth: 1,
        borderColor: on ? colors.ink : colors.line,
        backgroundColor: on ? colors.surface2 : colors.surface,
      }}
    >
      <Text size={14} weight={on ? 'semibold' : 'regular'}>
        {label}
      </Text>
    </Pressable>
  )
}

// More tab: the company default.
export function CompanySigninReminder() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const q = useSigninReminders()
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (default_minutes: number | null) => api.put<SigninReminderSettings>('/signin-reminders', { default_minutes }),
    onMutate: () => setError(null),
    onSuccess: (data) => queryClient.setQueryData(KEY, data),
    onError: (err) => setError(messageFor(err, 'Could not save.')),
  })
  const current = q.data?.default_minutes ?? null
  const choices = current !== null && !SIGNIN_CHOICES.includes(current) ? [...SIGNIN_CHOICES, current].sort((a, b) => a - b) : SIGNIN_CHOICES
  return (
    <Card style={{ marginHorizontal: 16, padding: 16, gap: 10 }}>
      <Text size={15} weight="semibold">
        Driver sign-in reminder
      </Text>
      <Text size={13} color={colors.muted} style={{ lineHeight: 18 }}>
        A push before the first stop of each run, only to drivers who have not signed in for it yet. No run that day, no reminder.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Chip label="Off" on={current === null} disabled={save.isPending || !q.data} onPress={() => save.mutate(null)} />
        {choices.map((m) => (
          <Chip key={m} label={`${m} min`} on={current === m} disabled={save.isPending || !q.data} onPress={() => save.mutate(m)} />
        ))}
      </View>
      <Text size={13} color={colors.muted}>
        {current === null ? 'Off for every driver.' : `${current} minutes before the first stop. Each driver can have their own (People).`}
      </Text>
      {error ? <ActionError message={error} /> : null}
    </Card>
  )
}

// People sheet: one driver's setting.
export function DriverSigninReminder({ driverId }: { driverId: string }) {
  const colors = useColors()
  const queryClient = useQueryClient()
  const q = useSigninReminders()
  const [error, setError] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: (body: { mode: SigninReminderDriver['mode']; minutes?: number }) => api.put(`/signin-reminders/drivers/${driverId}`, body),
    onMutate: () => setError(null),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: KEY }),
    onError: (err) => setError(messageFor(err, 'Could not save.')),
  })
  const d = q.data?.drivers.find((x) => x.id === driverId)
  const def = q.data?.default_minutes ?? null
  if (!d) return null
  return (
    <Card style={{ padding: 14, gap: 8 }}>
      <Text size={14} weight="semibold">
        Sign-in reminder
      </Text>
      {def === null ? (
        <Text size={13} color={colors.muted}>
          Off for the company (More tab).
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={`Default (${def} min)`} on={d.mode === 'default'} disabled={save.isPending} onPress={() => save.mutate({ mode: 'default' })} />
          {SIGNIN_CHOICES.filter((m) => m !== def).map((m) => (
            <Chip key={m} label={`${m} min`} on={d.mode === 'custom' && d.minutes === m} disabled={save.isPending} onPress={() => save.mutate({ mode: 'custom', minutes: m })} />
          ))}
          <Chip label="Off" on={d.mode === 'off'} disabled={save.isPending} onPress={() => save.mutate({ mode: 'off' })} />
        </View>
      )}
      <Text size={13} color={colors.muted}>
        {signinSummary(d)}
      </Text>
      {error ? <ActionError message={error} /> : null}
    </Card>
  )
}
