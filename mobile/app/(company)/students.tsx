import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import type { Student } from '@/api/types'
import { AddressText } from '@/components/AddressText'
import { CallButton } from '@/components/CallButton'
import { Card, KeyValueRow, SectionHeader } from '@/components/Card'
import { BottomSheet } from '@/components/Dialogs'
import { Screen } from '@/components/Screen'
import { ErrorState, Loading } from '@/components/States'
import { Text } from '@/components/Text'
import { PersonRow, SearchBox, WebsiteRow } from '@/features/admin/components'
import { useCompanyAssignments, useCompanyStudents, useCompanyVans, useDrivers, useSchools } from '@/features/admin/companyData'
import { matches, runsOn, WEBSITE_PAGES } from '@/features/admin/logic'
import { isoWeekday } from '@/features/monitor/helpers'
import { vanLabel } from '@/lib/fleet'
import { formatTimeOfDay, isAssignmentActiveToday } from '@/lib/format'
import { localISODate } from '@/lib/localDate'
import { formatWeekdays } from '@/lib/weekdays'
import { useColors } from '@/theme/theme'

const SHIFT_TEXT = { morning: 'Morning', afternoon: 'Afternoon', both: 'Morning + afternoon' } as const

function addressOf(s: Student): string | null {
  if (!s.street_address) return null
  return [s.street_address, s.city, [s.state, s.zip_code].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

// Company admin, Students tab: every student with their school and ride, the parent's and the
// driver's phone to call, and the home address (tap to copy). Editing is on the website.
export default function CompanyStudentsScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const students = useCompanyStudents()
  const schools = useSchools()
  const assignments = useCompanyAssignments()
  const drivers = useDrivers()
  const vans = useCompanyVans()

  const schoolName = useMemo(() => new Map((schools.data ?? []).map((s) => [s.id, s.name])), [schools.data])
  const rides = useMemo(() => {
    const driverById = new Map((drivers.data ?? []).map((d) => [d.id, d]))
    const vanById = new Map((vans.data ?? []).map((v) => [v.id, v]))
    const today = localISODate()
    const dow = isoWeekday()
    const byStudent = new Map<string, { id: string; label: string; driverName: string; driverPhone: string | null; van: string; when: string; today: boolean }[]>()
    for (const a of assignments.data ?? []) {
      if (!isAssignmentActiveToday(a.start_date, a.end_date) && a.start_date.slice(0, 10) <= today) continue
      const d = driverById.get(a.driver_user_id)
      const list = byStudent.get(a.student_id) ?? []
      list.push({
        id: a.id,
        label: SHIFT_TEXT[a.shift_period],
        driverName: d?.full_name ?? 'Driver',
        driverPhone: d?.phone ?? null,
        van: vanLabel(vanById.get(a.van_id)),
        when: [formatWeekdays(a.days_of_week), a.pickup_time ? `pickup ${formatTimeOfDay(a.pickup_time)}` : null, a.dropoff_time ? `drop-off ${formatTimeOfDay(a.dropoff_time)}` : null]
          .filter(Boolean)
          .join(' · '),
        today: runsOn(a, today, dow),
      })
      byStudent.set(a.student_id, list)
    }
    return byStudent
  }, [assignments.data, drivers.data, vans.data])

  const list = (students.data ?? []).filter((s) => matches(q, s.full_name, s.parent_name, schoolName.get(s.school_id)))
  const open = (students.data ?? []).find((s) => s.id === openId) ?? null
  const refresh = () => {
    for (const key of [['students'], ['schools'], ['assignments'], ['users', 'driver'], ['vans']]) void queryClient.invalidateQueries({ queryKey: key })
  }

  return (
    <Screen refreshing={students.isFetching} onRefresh={refresh}>
      <SectionHeader title="Students" aside={students.data ? `${students.data.length}` : undefined} />
      <View style={{ marginHorizontal: 16, gap: 10 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search students, parents, schools" />
      </View>
      <Card style={{ marginHorizontal: 16, marginTop: 12 }}>
        {students.isLoading ? (
          <Loading />
        ) : students.error ? (
          <ErrorState error={students.error} onRetry={refresh} />
        ) : list.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            {q ? `No students match "${q}".` : 'No students yet.'}
          </Text>
        ) : (
          list.map((s, i) => {
            const r = rides.get(s.id) ?? []
            return (
              <PersonRow
                key={s.id}
                first={i === 0}
                name={s.full_name}
                sub={[schoolName.get(s.school_id), s.grade ? `Grade ${s.grade}` : null].filter(Boolean).join(' · ') || null}
                badge={r.length === 0 ? { label: 'No ride', tone: 'caution' } : r.some((x) => x.today) ? { label: 'Rides today', tone: 'info' } : null}
                onPress={() => setOpenId(s.id)}
              />
            )
          })
        )}
      </Card>
      <View style={{ marginHorizontal: 16, marginTop: 16 }}>
        <WebsiteRow label="Add or edit students" path={WEBSITE_PAGES.students} icon="edit" />
      </View>

      {open ? (
        <BottomSheet
          label={`${open.full_name}, details`}
          onClose={() => setOpenId(null)}
          header={
            <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 2 }}>
              <Text size={18} weight="semibold">
                {open.full_name}
              </Text>
              <Text size={13} color={colors.muted}>
                {[schoolName.get(open.school_id), open.grade ? `Grade ${open.grade}` : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
          }
        >
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text size={12} color={colors.muted}>
                  Parent
                </Text>
                <Text size={15} weight="medium">
                  {open.parent_name ?? 'Not on file'}
                </Text>
                {open.parent_phone ? (
                  <Text size={13} color={colors.muted}>
                    {open.parent_phone}
                  </Text>
                ) : null}
              </View>
              {open.parent_phone ? <CallButton phone={open.parent_phone} primary label={`Call ${open.parent_name ?? 'parent'}`} /> : null}
            </View>
          </Card>
          <Card>
            <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 2 }}>
              <Text size={12} color={colors.muted}>
                Home address
              </Text>
              {addressOf(open) ? <AddressText address={addressOf(open)!} /> : <Text size={14}>Not on file</Text>}
            </View>
          </Card>
          <Text size={13} weight="semibold" color={colors.muted}>
            Rides
          </Text>
          {(rides.get(open.id) ?? []).length === 0 ? (
            <Text size={14} color={colors.muted}>
              No current ride. Assign one on the website.
            </Text>
          ) : (
            (rides.get(open.id) ?? []).map((r) => (
              <Card key={r.id}>
                <KeyValueRow label={r.label} value={r.today ? 'Rides today' : 'Not today'} first />
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderTopColor: colors.divider }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text size={15} weight="medium">
                      {r.driverName}
                    </Text>
                    <Text size={12} color={colors.muted}>
                      {r.van}
                    </Text>
                    <Text size={12} color={colors.muted}>
                      {r.when}
                    </Text>
                  </View>
                  {r.driverPhone ? <CallButton phone={r.driverPhone} label={`Call ${r.driverName}`} /> : null}
                </View>
              </Card>
            ))
          )}
          {open.notes ? (
            <Card>
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, gap: 2 }}>
                <Text size={12} color={colors.muted}>
                  Notes
                </Text>
                <Text size={14}>{open.notes}</Text>
              </View>
            </Card>
          ) : null}
          <WebsiteRow label="Edit student" path={WEBSITE_PAGES.students} icon="edit" />
        </BottomSheet>
      ) : null}
    </Screen>
  )
}
