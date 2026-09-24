import { useMemo, useState } from 'react'
import { Linking, TextInput, View } from 'react-native'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { CreatedUser, Monitor, PasswordResetResult, PublicUser } from '@/api/types'
import { Button } from '@/components/Button'
import { Card, KeyValueRow, SectionHeader } from '@/components/Card'
import { BottomSheet } from '@/components/Dialogs'
import { Field, inputStyle } from '@/components/Form'
import { Screen } from '@/components/Screen'
import { ActionError, ErrorState, Loading, messageFor } from '@/components/States'
import { Text } from '@/components/Text'
import { PersonRow, SearchBox, Segmented, TemporaryPasswordPanel, WebsiteRow } from '@/features/admin/components'
import { useCompanyAssignments, useCompanySessions, useCompanyVans, useDrivers, useMonitors, useParents } from '@/features/admin/companyData'
import { matches, WEBSITE_PAGES } from '@/features/admin/logic'
import { currentAssignmentBy, vanLabel } from '@/lib/fleet'
import { formatClock } from '@/lib/format'
import { formatWeekdays } from '@/lib/weekdays'
import { useColors } from '@/theme/theme'

type Kind = 'driver' | 'monitor' | 'parent'
const SHIFT_TEXT = { morning: 'Mornings', afternoon: 'Afternoons', both: 'Mornings and afternoons' } as const

// One person on this screen, whatever their role: what the list and the details sheet show.
interface Person {
  user: PublicUser
  kind: Kind
  onShiftSince: string | null
  lines: { label: string; value: string }[]
}

const asUser = (m: Monitor): PublicUser => ({ ...m, address: null, license_number: null, email_verified_at: null })

// Company admin, People tab: drivers, monitors and parents with tap to call, their details,
// adding a driver or monitor (temporary password) and resetting a password. Editing and
// assigning are on the website.
export default function PeopleScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [kind, setKind] = useState<Kind>('driver')
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const drivers = useDrivers()
  const monitors = useMonitors()
  const parents = useParents()
  const sessions = useCompanySessions()
  const assignments = useCompanyAssignments()
  const vans = useCompanyVans()

  const people = useMemo<Person[]>(() => {
    const open = new Map((sessions.data ?? []).filter((s) => s.check_out_at === null).map((s) => [s.user_id, s.check_in_at]))
    const current = currentAssignmentBy(assignments.data ?? [], 'driver_user_id')
    const vanById = new Map((vans.data ?? []).map((v) => [v.id, v]))
    const d: Person[] = (drivers.data ?? []).map((u) => {
      const a = current.get(u.id)
      return {
        user: u,
        kind: 'driver',
        onShiftSince: open.get(u.id) ?? null,
        lines: [
          { label: 'Van today', value: a ? vanLabel(vanById.get(a.van_id)) : 'No active assignment' },
          { label: 'License', value: u.license_number ?? '—' },
        ],
      }
    })
    const m: Person[] = (monitors.data ?? []).map((x) => ({
      user: asUser(x),
      kind: 'monitor',
      onShiftSince: x.open_session?.check_in_at ?? null,
      lines: [
        { label: 'Rides with', value: x.assignment?.driver_name ?? 'No driver yet' },
        { label: 'When', value: x.assignment ? `${formatWeekdays(x.assignment.days_of_week)} · ${SHIFT_TEXT[x.assignment.shift_period]}` : '—' },
      ],
    }))
    const p: Person[] = (parents.data ?? []).map((u) => ({ user: u, kind: 'parent', onShiftSince: null, lines: [{ label: 'Address', value: u.address ?? '—' }] }))
    return [...d, ...m, ...p]
  }, [drivers.data, monitors.data, parents.data, sessions.data, assignments.data, vans.data])

  const list = people.filter((p) => p.kind === kind && matches(q, p.user.full_name, p.user.email, p.user.phone))
  const open = people.find((p) => p.user.id === openId) ?? null
  const source = kind === 'driver' ? drivers : kind === 'monitor' ? monitors : parents
  const refresh = () => {
    for (const key of [['users', 'driver'], ['users', 'parent'], ['monitors'], ['sessions', 'all'], ['assignments'], ['vans']]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  const noun = kind === 'driver' ? 'driver' : kind === 'monitor' ? 'monitor' : 'parent'

  return (
    <Screen refreshing={source.isFetching} onRefresh={refresh}>
      <SectionHeader title="People" />
      <View style={{ marginHorizontal: 16, gap: 10 }}>
        <Segmented
          value={kind}
          onChange={(k) => {
            setKind(k)
            setQ('')
          }}
          options={[
            { value: 'driver', label: 'Drivers' },
            { value: 'monitor', label: 'Monitors' },
            { value: 'parent', label: 'Parents' },
          ]}
        />
        <SearchBox value={q} onChange={setQ} placeholder={`Search ${noun}s`} />
        {kind === 'parent' ? (
          <WebsiteRow label="Add or link parents" path={WEBSITE_PAGES.parents} icon="family-restroom" />
        ) : (
          <Button label={`Add ${noun}`} icon="person-add" variant="outline" onPress={() => setAdding(true)} />
        )}
      </View>

      <Card style={{ marginHorizontal: 16, marginTop: 12 }}>
        {source.isLoading ? (
          <Loading />
        ) : source.error ? (
          <ErrorState error={source.error} onRetry={refresh} />
        ) : list.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            {q ? `No ${noun}s match "${q}".` : `No ${noun}s yet.`}
          </Text>
        ) : (
          list.map((p, i) => (
            <PersonRow
              key={p.user.id}
              first={i === 0}
              name={p.user.full_name}
              sub={p.kind === 'parent' ? p.user.email : p.lines[0]?.value}
              badge={
                !p.user.is_active
                  ? { label: 'Deactivated', tone: 'alert' }
                  : p.kind === 'parent'
                    ? null
                    : p.onShiftSince
                      ? { label: 'On shift', tone: 'success' }
                      : { label: 'Not in', tone: 'neutral' }
              }
              phone={p.user.phone}
              onPress={() => setOpenId(p.user.id)}
            />
          ))
        )}
      </Card>

      {open ? <PersonSheet person={open} onClose={() => setOpenId(null)} /> : null}
      {adding && kind !== 'parent' ? <AddPersonSheet kind={kind} onClose={() => setAdding(false)} /> : null}
    </Screen>
  )
}

function PersonSheet({ person, onClose }: { person: Person; onClose: () => void }) {
  const colors = useColors()
  const queryClient = useQueryClient()
  const { user } = person
  const [confirmReset, setConfirmReset] = useState(false)
  const [reset, setReset] = useState<PasswordResetResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resetPassword = useMutation({
    mutationFn: () => api.post<PasswordResetResult>(`/users/${user.id}/reset-password`),
    onSuccess: (res) => {
      setReset(res)
      void queryClient.invalidateQueries({ queryKey: person.kind === 'monitor' ? ['monitors'] : ['users', person.kind] })
    },
    onError: (err) => setError(messageFor(err, 'Could not reset the password.')),
  })

  const role = person.kind === 'driver' ? 'Driver' : person.kind === 'monitor' ? 'Monitor' : 'Parent'
  const page = person.kind === 'driver' ? WEBSITE_PAGES.drivers : person.kind === 'monitor' ? WEBSITE_PAGES.monitors : WEBSITE_PAGES.parents

  return (
    <BottomSheet
      label={`${user.full_name}, details`}
      onClose={onClose}
      header={
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 2 }}>
          <Text size={18} weight="semibold">
            {user.full_name}
          </Text>
          <Text size={13} color={colors.muted}>
            {role}
            {person.onShiftSince ? ` · on shift since ${formatClock(person.onShiftSince)}` : ''}
            {!user.is_active ? ' · deactivated' : ''}
          </Text>
        </View>
      }
    >
      {reset ? (
        <TemporaryPasswordPanel reset name={user.full_name} email={reset.user.email} password={reset.temporary_password} onDone={onClose} />
      ) : (
        <>
          <Card>
            <KeyValueRow label="Phone" value={user.phone ?? 'Not on file'} first />
            <KeyValueRow label="Email" value={user.email} first={false} />
            {person.lines.map((l) => (
              <KeyValueRow key={l.label} label={l.label} value={l.value} first={false} />
            ))}
            {user.must_change_password ? <KeyValueRow label="Password" value="Temporary (not changed yet)" first={false} /> : null}
          </Card>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {user.phone ? (
              <Button
                label="Call"
                icon="call"
                style={{ flex: 1 }}
                onPress={() => void Linking.openURL(`tel:${user.phone!.replace(/[^0-9+]/g, '')}`)}
              />
            ) : null}
            <Button label="Email" icon="mail-outline" variant="outline" style={{ flex: 1 }} onPress={() => void Linking.openURL(`mailto:${user.email}`)} />
          </View>
          {error ? <ActionError message={error} /> : null}
          {confirmReset ? (
            <View style={{ gap: 8 }}>
              <Text size={14} style={{ lineHeight: 20 }}>
                Reset {user.full_name}&apos;s password? Their current password and every signed-in device stop working. You get a new
                temporary password to give them.
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label="Cancel" variant="outline" style={{ flex: 1 }} onPress={() => setConfirmReset(false)} />
                <Button label="Reset" variant="danger" style={{ flex: 1 }} busy={resetPassword.isPending} busyLabel="Resetting…" onPress={() => resetPassword.mutate()} />
              </View>
            </View>
          ) : (
            <Button label="Reset password" icon="lock-reset" variant="outline" onPress={() => setConfirmReset(true)} />
          )}
          <WebsiteRow label={person.kind === 'monitor' ? 'Edit or assign to a driver' : 'Edit details'} path={page} icon="edit" />
        </>
      )}
    </BottomSheet>
  )
}

// Add a driver or a monitor: name + email (phone optional). The server makes a temporary
// password, shown here once, and the person sets their own at first sign-in.
function AddPersonSheet({ kind, onClose }: { kind: 'driver' | 'monitor'; onClose: () => void }) {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreatedUser | null>(null)
  const noun = kind === 'driver' ? 'driver' : 'monitor'
  const add = useMutation({
    mutationFn: () => api.post<CreatedUser>('/users', { role: kind, fullName: name.trim(), email: email.trim(), phone: phone.trim() || undefined }),
    onMutate: () => setError(null),
    onSuccess: (u) => {
      setCreated(u)
      void queryClient.invalidateQueries({ queryKey: kind === 'monitor' ? ['monitors'] : ['users', 'driver'] })
    },
    onError: (err) => setError(messageFor(err, `Could not add the ${noun}.`)),
  })
  const input = inputStyle(colors.ink, colors.line, colors.surface)

  return (
    <BottomSheet
      label={`Add ${noun}`}
      onClose={onClose}
      header={
        <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
          <Text size={18} weight="semibold">
            {created ? 'Account created' : `Add ${noun}`}
          </Text>
        </View>
      }
    >
      {created ? (
        <TemporaryPasswordPanel name={created.full_name} email={created.email} password={created.temporary_password} onDone={onClose} />
      ) : (
        <>
          <Field label="Full name">
            <TextInput value={name} onChangeText={setName} placeholder="Jordan Ellis" placeholderTextColor={colors.faint} style={input} accessibilityLabel="Full name" />
          </Field>
          <Field label="Email (used to sign in)">
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholderTextColor={colors.faint}
              style={input}
              accessibilityLabel="Email"
            />
          </Field>
          <Field label="Phone (optional)">
            <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="555-123-4567" placeholderTextColor={colors.faint} style={input} accessibilityLabel="Phone" />
          </Field>
          <Text size={13} color={colors.muted} style={{ lineHeight: 18 }}>
            SafeRoute makes a temporary password for you to give the {noun}. They choose their own the first time they sign in.
            {kind === 'monitor' ? ' Assign them to a driver on the website.' : ''}
          </Text>
          {error ? <ActionError message={error} /> : null}
          <Button label={`Add ${noun}`} busy={add.isPending} busyLabel="Adding…" disabled={!name.trim() || !email.trim()} onPress={() => add.mutate()} />
        </>
      )}
    </BottomSheet>
  )
}
