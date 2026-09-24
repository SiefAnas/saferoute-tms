import { useMemo } from 'react'
import { View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { Card, SectionHeader } from '@/components/Card'
import { Screen } from '@/components/Screen'
import { ErrorState, Loading } from '@/components/States'
import { Text } from '@/components/Text'
import { PersonRow, StatTile, WebsiteRow } from '@/features/admin/components'
import { useAbsentToday, useCompanyAssignments, useCompanySessions, useCompanyStudents, useDrivers, useMonitors } from '@/features/admin/companyData'
import { absentLabel, runsOn, WEBSITE_PAGES, whoIsCheckedIn } from '@/features/admin/logic'
import { isoWeekday } from '@/features/monitor/helpers'
import { formatClock } from '@/lib/format'
import { localISODate } from '@/lib/localDate'
import { useColors } from '@/theme/theme'

const SHIFT = { morning: 'Morning', afternoon: 'Afternoon' } as const

// Company admin, Today tab: who is working right now (tap to call), which drivers with runs
// today haven't checked in, and today's absences. Numbers come straight from the same lists
// the website uses; nothing is estimated.
export default function CompanyHomeScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const drivers = useDrivers()
  const monitors = useMonitors()
  const sessions = useCompanySessions()
  const students = useCompanyStudents()
  const assignments = useCompanyAssignments()
  const absent = useAbsentToday()

  const view = useMemo(() => {
    const today = localISODate()
    const dow = isoWeekday()
    const running = (assignments.data ?? []).filter((a) => runsOn(a, today, dow))
    const driversWithRuns = new Set(running.map((a) => a.driver_user_id))
    const activeDrivers = (drivers.data ?? []).filter((d) => d.is_active)
    const onShift = whoIsCheckedIn(activeDrivers, sessions.data ?? [], monitors.data ?? [])
    const onShiftIds = new Set(onShift.map((o) => o.id))
    const notIn = activeDrivers.filter((d) => driversWithRuns.has(d.id) && !onShiftIds.has(d.id))
    const activeMonitors = (monitors.data ?? []).filter((m) => m.is_active)
    return {
      onShift,
      notIn,
      driversOn: onShift.filter((o) => o.role === 'driver').length,
      driverCount: activeDrivers.length,
      monitorsOn: onShift.filter((o) => o.role === 'monitor').length,
      monitorCount: activeMonitors.length,
      studentsToday: new Set(running.map((a) => a.student_id)).size,
      studentCount: (students.data ?? []).length,
    }
  }, [drivers.data, monitors.data, sessions.data, students.data, assignments.data])

  const queries = [drivers, monitors, sessions, students, assignments, absent]
  const loading = queries.some((q) => q.isLoading)
  const failed = queries.find((q) => q.error)?.error
  const refresh = () => {
    for (const key of [['users', 'driver'], ['monitors'], ['sessions', 'all'], ['students'], ['assignments'], ['dashboard-absent-today']]) {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }

  if (loading) {
    return (
      <Screen>
        <Loading label="Loading today…" />
      </Screen>
    )
  }
  if (failed) {
    return (
      <Screen onRefresh={refresh}>
        <ErrorState error={failed} onRetry={refresh} />
      </Screen>
    )
  }

  const absences = absent.data ?? []

  return (
    <Screen refreshing={queries.some((q) => q.isFetching)} onRefresh={refresh}>
      <SectionHeader title="Today" />
      <View style={{ marginHorizontal: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <StatTile label="Drivers on shift" value={view.driversOn} sub={`of ${view.driverCount} active`} tone={view.driversOn ? 'success' : undefined} />
        <StatTile label="Not checked in" value={view.notIn.length} sub="drivers with runs today" tone={view.notIn.length ? 'caution' : undefined} />
        <StatTile label="Students riding today" value={view.studentsToday} sub={`of ${view.studentCount} students`} />
        <StatTile label="Absent today" value={absences.length} sub="skips and no-shows" tone={absences.length ? 'caution' : undefined} />
        {view.monitorCount > 0 ? (
          <StatTile label="Monitors on shift" value={view.monitorsOn} sub={`of ${view.monitorCount} active`} tone={view.monitorsOn ? 'success' : undefined} />
        ) : null}
      </View>

      <SectionHeader title="Checked in now" aside={`${view.onShift.length}`} />
      <Card style={{ marginHorizontal: 16 }}>
        {view.onShift.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            Nobody is checked in right now.
          </Text>
        ) : (
          view.onShift.map((o, i) => (
            <PersonRow
              key={o.id}
              first={i === 0}
              name={o.name}
              sub={`${o.role === 'monitor' ? `Monitor${o.ridesWith ? ` · with ${o.ridesWith}` : ''}` : 'Driver'} · ${o.shift ? SHIFT[o.shift] : 'Shift'} since ${formatClock(o.since)}`}
              badge={{ label: 'On shift', tone: 'success' }}
              phone={o.phone}
            />
          ))
        )}
      </Card>

      {view.notIn.length > 0 ? (
        <>
          <SectionHeader title="Not checked in yet" aside="have runs today" />
          <Card style={{ marginHorizontal: 16 }}>
            {view.notIn.map((d, i) => (
              <PersonRow key={d.id} first={i === 0} name={d.full_name} sub="Driver" badge={{ label: 'Not in', tone: 'caution' }} phone={d.phone} />
            ))}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Absent today" aside={`${absences.length}`} />
      <Card style={{ marginHorizontal: 16 }}>
        {absences.length === 0 ? (
          <Text size={14} color={colors.muted} style={{ padding: 16 }}>
            No skips or no-shows today.
          </Text>
        ) : (
          absences.map((e, i) => (
            <PersonRow
              key={`${e.student_id}-${e.type}`}
              first={i === 0}
              name={e.student_name}
              sub={formatClock(e.at)}
              badge={{ label: absentLabel(e), tone: e.type === 'parent_skipped' ? 'info' : 'alert' }}
            />
          ))
        )}
      </Card>

      <View style={{ marginHorizontal: 16, marginTop: 16 }}>
        <WebsiteRow label="Full dashboard" path={WEBSITE_PAGES.dashboard} icon="dashboard" />
      </View>
    </Screen>
  )
}
