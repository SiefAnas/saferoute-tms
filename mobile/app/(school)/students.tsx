import { useState } from 'react'
import { View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { Student } from '@/api/types'
import { CallButton } from '@/components/CallButton'
import { Card, SectionHeader } from '@/components/Card'
import { BottomSheet } from '@/components/Dialogs'
import { Screen } from '@/components/Screen'
import { ErrorState, Loading } from '@/components/States'
import { Text } from '@/components/Text'
import { PersonRow, SearchBox } from '@/features/admin/components'
import { matches } from '@/features/admin/logic'
import { vanLabel } from '@/lib/fleet'
import { useColors } from '@/theme/theme'

const SHIFT_TEXT = { morning: 'Morning', afternoon: 'Afternoon', both: 'Morning + afternoon' } as const

// School admin / staff, Students tab: the school's students (staff: only the ones granted to
// them) with who takes them (company, van, driver to call) and the parent to call.
export default function SchoolStudentsScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const studentsQuery = useQuery({ queryKey: ['students'], queryFn: () => api.get<Student[]>('/students') })
  const list = (studentsQuery.data ?? []).filter((s) => matches(q, s.full_name, s.parent_name, ...(s.transport ?? []).map((t) => t.driver?.full_name)))
  const open = (studentsQuery.data ?? []).find((s) => s.id === openId) ?? null
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['students'] })

  return (
    <Screen refreshing={studentsQuery.isFetching} onRefresh={refresh}>
      <SectionHeader title="Students" aside={studentsQuery.data ? `${studentsQuery.data.length}` : undefined} />
      <View style={{ marginHorizontal: 16 }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search students, parents, drivers" />
      </View>
      <Card style={{ marginHorizontal: 16, marginTop: 12 }}>
        {studentsQuery.isLoading ? (
          <Loading />
        ) : studentsQuery.error ? (
          <ErrorState error={studentsQuery.error} onRetry={refresh} />
        ) : list.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            {q ? `No students match "${q}".` : 'No students to show.'}
          </Text>
        ) : (
          list.map((s, i) => {
            const t = s.transport ?? []
            return (
              <PersonRow
                key={s.id}
                first={i === 0}
                name={s.full_name}
                sub={t.length ? t.map((x) => x.driver?.full_name ?? x.company_name).filter(Boolean).join(', ') : s.grade ? `Grade ${s.grade}` : null}
                badge={t.length === 0 ? { label: 'No ride', tone: 'neutral' } : null}
                onPress={() => setOpenId(s.id)}
              />
            )
          })
        )}
      </Card>

      {open ? (
        <BottomSheet
          label={`${open.full_name}, details`}
          onClose={() => setOpenId(null)}
          header={
            <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8, gap: 2 }}>
              <Text size={18} weight="semibold">
                {open.full_name}
              </Text>
              {open.grade ? (
                <Text size={13} color={colors.muted}>
                  Grade {open.grade}
                </Text>
              ) : null}
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
          <Text size={13} weight="semibold" color={colors.muted}>
            Rides
          </Text>
          {(open.transport ?? []).length === 0 ? (
            <Text size={14} color={colors.muted}>
              No transport company takes this student right now.
            </Text>
          ) : (
            (open.transport ?? []).map((t, i) => (
              <Card key={`${t.shift_period}-${i}`}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text size={12} color={colors.muted}>
                      {SHIFT_TEXT[t.shift_period]}
                      {t.company_name ? ` · ${t.company_name}` : ''}
                    </Text>
                    <Text size={15} weight="medium">
                      {t.driver?.full_name ?? 'No driver'}
                    </Text>
                    {t.van ? (
                      <Text size={12} color={colors.muted}>
                        {vanLabel(t.van)}
                        {t.van.color ? ` · ${t.van.color}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  {t.driver?.phone ? <CallButton phone={t.driver.phone} label={`Call ${t.driver.full_name}`} /> : null}
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
        </BottomSheet>
      ) : null}
    </Screen>
  )
}
