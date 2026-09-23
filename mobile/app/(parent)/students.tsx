import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { Student } from '@/api/types'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Loading } from '@/components/States'
import { Text } from '@/components/Text'
import { firstName } from '@/lib/format'
import { useColors } from '@/theme/theme'
import { ChildView } from '@/features/parent/ChildView'

// Parent app, Students tab (design 5b). Everything shown is real: GET /parent/students,
// /parent/students/:id/detail (van, driver, times, today's trips) and /skip-status.
// Parents only ever call /parent/* — /students, /trips, /sessions, /assignments and /vans
// answer 403 for this role by design (API_CONTRACT.md §4).
export default function ParentStudentsScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const studentsQuery = useQuery({
    queryKey: ['parent-students'],
    queryFn: () => api.get<Student[]>('/parent/students'),
  })

  const students = studentsQuery.data ?? []
  // Derived, not synced: with nothing picked yet (or after a child is unlinked) this falls
  // back to the first child rather than needing an effect to seed the state.
  const selected = students.find((s) => s.id === selectedId) ?? students[0] ?? null

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['parent-students'] })
    void queryClient.invalidateQueries({ queryKey: ['parent-student-detail'] })
    void queryClient.invalidateQueries({ queryKey: ['skip-status'] })
  }

  if (studentsQuery.isLoading) {
    return (
      <Screen>
        <Loading label="Loading your children…" />
      </Screen>
    )
  }

  if (studentsQuery.error && !studentsQuery.data) {
    return (
      <Screen refreshing={studentsQuery.isFetching} onRefresh={refresh}>
        <View style={{ paddingTop: 16 }}>
          <ErrorState error={studentsQuery.error} onRetry={refresh} />
        </View>
      </Screen>
    )
  }

  if (students.length === 0) {
    return (
      <Screen refreshing={studentsQuery.isFetching} onRefresh={refresh}>
        <View style={{ paddingTop: 16 }}>
          <EmptyState
            icon="family-restroom"
            title="No children linked yet"
            body="Ask your transportation company to link your child to your account. They'll show up here."
          />
        </View>
      </Screen>
    )
  }

  return (
    <ChildScreen
      key={selected?.id ?? 'none'}
      student={selected}
      chips={
        students.length > 1 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingBottom: 4 }}
          >
            {students.map((s) => {
              const active = selected?.id === s.id
              return (
                <Pressable
                  key={s.id}
                  onPress={() => setSelectedId(s.id)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={s.full_name}
                  hitSlop={{ top: 4, bottom: 4 }} // 36pt chip + slop = 44pt touch target
                  style={{
                    height: 36,
                    justifyContent: 'center',
                    paddingHorizontal: 16,
                    borderRadius: 18,
                    backgroundColor: active ? colors.action : colors.surface,
                    borderWidth: active ? 0 : 1,
                    borderColor: colors.line,
                  }}
                >
                  <Text size={14} weight="medium" color={active ? colors.onAction : colors.ink}>
                    {firstName(s.full_name)}
                  </Text>
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null
      }
    />
  )
}

// The chips stay mounted while the selected child's detail loads, so switching children does
// not make the whole screen jump.
function ChildScreen({ student, chips }: { student: Student | null; chips: React.ReactNode }) {
  if (!student) {
    return (
      <Screen>
        {chips}
        <Loading />
      </Screen>
    )
  }
  return <ChildView student={student} chips={chips} />
}
