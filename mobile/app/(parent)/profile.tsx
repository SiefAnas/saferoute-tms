import { View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api'
import type { ParentProfile, ParentStudentDetail, Student } from '@/api/types'
import { useAuth } from '@/auth/auth'
import { Button } from '@/components/Button'
import { AddressText } from '@/components/AddressText'
import { Card, Divided, KeyValueRow, SectionHeader } from '@/components/Card'
import { Screen } from '@/components/Screen'
import { ErrorState, Loading } from '@/components/States'
import { Text } from '@/components/Text'
import { ThemeChooser } from '@/components/ThemeChooser'
import { useColors } from '@/theme/theme'

// Parent app, Profile tab (design 5b): read-only rows plus the note about who can change them.
// There is no PATCH /me on the server, and only the admin who created the account can edit it
// (API_CONTRACT.md §2, V2_ROADMAP.md "Self-service profile edit"), so nothing here is editable.
export default function ParentProfileScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const { user, signOut } = useAuth()

  const profileQuery = useQuery({
    queryKey: ['parent-me'],
    queryFn: () => api.get<ParentProfile>('/parent/me'),
  })

  // The transport company's name and phone are not on /parent/me; they come with each child's
  // detail. Reuse the already-cached students list and read the first child's company.
  const studentsQuery = useQuery({
    queryKey: ['parent-students'],
    queryFn: () => api.get<Student[]>('/parent/students'),
  })
  const firstStudentId = studentsQuery.data?.[0]?.id
  const detailQuery = useQuery({
    queryKey: ['parent-student-detail', firstStudentId],
    queryFn: () => api.get<ParentStudentDetail>(`/parent/students/${firstStudentId}/detail`),
    enabled: Boolean(firstStudentId),
  })
  const company = detailQuery.data?.company ?? null

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['parent-me'] })
    void queryClient.invalidateQueries({ queryKey: ['parent-students'] })
  }

  const p = profileQuery.data

  const rows: { label: string; value: string }[] = p
    ? [
        { label: 'Name', value: p.full_name },
        { label: 'Email', value: p.email },
        { label: 'Phone', value: p.phone ?? 'Not on file' },
        ...(p.address ? [] : [{ label: 'Address', value: 'Not on file' }]),
        { label: 'Transport company', value: company?.name ?? '—' },
      ]
    : []

  return (
    <Screen refreshing={profileQuery.isFetching} onRefresh={refresh}>
      <SectionHeader title="Profile" />
      {profileQuery.isLoading ? (
        <Loading />
      ) : !p ? (
        <ErrorState error={profileQuery.error} onRetry={refresh} />
      ) : (
        <>
          <Card style={{ marginHorizontal: 16 }}>
            {rows.map((r, i) => (
              <KeyValueRow key={r.label} label={r.label} value={r.value} first={i === 0} />
            ))}
            {p.address ? (
              <Divided first={false}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 14, paddingVertical: 12 }}>
                  <Text size={14} color={colors.muted}>
                    Address
                  </Text>
                  <View style={{ flexShrink: 1 }}>
                    <AddressText address={p.address} size={14} color={colors.ink} style={{ textAlign: 'right' }} />
                  </View>
                </View>
              </Divided>
            ) : null}
          </Card>
          <Text
            size={12}
            color={colors.muted}
            style={{ marginHorizontal: 20, marginTop: 10, lineHeight: 18 }}
          >
            To change your details, contact {company?.name ?? 'your transportation company'}
            {company?.phone ? ` on ${company.phone}` : ''}.
          </Text>
        </>
      )}

      <View style={{ marginHorizontal: 16, marginTop: 24 }}>
        <ThemeChooser />
      </View>

      <View style={{ marginHorizontal: 16, marginTop: 24 }}>
        <Button label="Log out" variant="outline" onPress={() => void signOut()} />
      </View>
      <Text size={12} color={colors.faint} style={{ textAlign: 'center', marginTop: 10 }}>
        Signed in as {user?.email ?? 'unknown'}
      </Text>
    </Screen>
  )
}
