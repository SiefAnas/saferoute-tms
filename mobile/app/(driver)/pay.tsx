import { useMemo } from 'react'
import { View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/api'
import type { PaySummary } from '@/api/types'
import { useAuth } from '@/auth/auth'
import { Card, SectionHeader } from '@/components/Card'
import { ComingSoonRow } from '@/components/Dialogs'
import { Screen } from '@/components/Screen'
import { EmptyState, ErrorState, Loading } from '@/components/States'
import { Text } from '@/components/Text'
import { formatMoney, formatRate } from '@/lib/format'
import { localISODate } from '@/lib/localDate'
import { radius } from '@/theme/tokens'
import { useColors } from '@/theme/theme'
import { useDriverSessions } from '@/features/driver/data'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// Driver app, Pay tab (design 3a): this month's pay so far from
// GET /payroll/summary/:driverId (own id only), and a calendar of the days actually worked,
// taken from the driver's own sessions. Nothing is estimated — if there is no pay rule yet,
// the card says so instead of showing a zero.
export default function PayScreen() {
  const colors = useColors()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { sessions, query: sessionsQuery } = useDriverSessions()

  const now = new Date()
  // The month range the web app also sends: the 1st of this month to the 1st of next month
  // (`to` is exclusive), both as local calendar dates.
  const { from, to } = useMemo(() => {
    const d = new Date()
    return {
      from: localISODate(new Date(d.getFullYear(), d.getMonth(), 1)),
      to: localISODate(new Date(d.getFullYear(), d.getMonth() + 1, 1)),
    }
  }, [])

  const payQuery = useQuery({
    queryKey: ['payroll-summary', user?.id, from, to],
    queryFn: () => api.get<PaySummary>(`/payroll/summary/${user!.id}?from=${from}&to=${to}`),
    enabled: Boolean(user?.id),
    // A 404 here means "no pay rule for this driver" — an expected state, not a failure.
    retry: false,
  })

  // Which days this month the driver actually worked, by the local day of each check-in.
  const worked = useMemo(() => {
    const days = new Set<string>()
    for (const s of sessions) days.add(localISODate(new Date(s.check_in_at)))
    return days
  }, [sessions])

  const year = now.getFullYear()
  const month = now.getMonth()
  const lead = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayKey = localISODate(now)
  const monthName = now.toLocaleDateString(undefined, { month: 'long' })

  const p = payQuery.data
  const noRate = payQuery.error instanceof ApiError && payQuery.error.status === 404
  const hours = p ? (p.worked_minutes / 60).toFixed(p.worked_minutes % 60 === 0 ? 0 : 2) : ''

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['payroll-summary'] })
    void queryClient.invalidateQueries({ queryKey: ['sessions'] })
  }

  return (
    <Screen refreshing={payQuery.isFetching || sessionsQuery.isFetching} onRefresh={refresh}>
      <SectionHeader title="Pay" aside={monthName} />

      <Card style={{ marginHorizontal: 16, padding: 16, gap: 4 }}>
        {payQuery.isLoading ? (
          <Loading label="Loading your pay…" />
        ) : noRate ? (
          <EmptyState
            icon="payments"
            title="No pay rate yet"
            body="Your company hasn't set your pay rate. Ask the office to add it, and this month's total will show up here."
          />
        ) : payQuery.error ? (
          <ErrorState error={payQuery.error} onRetry={refresh} />
        ) : p ? (
          <>
            <Text size={13} color={colors.muted}>
              This month so far
            </Text>
            <Text size={32} weight="semibold" tabular style={{ letterSpacing: -0.64, lineHeight: 40 }}>
              {formatMoney(p.total_pay_cents)}
            </Text>
            <Text size={13} color={colors.muted} tabular>
              {p.worked_days} {p.worked_days === 1 ? 'day' : 'days'} · {hours} h at{' '}
              {formatRate(p.rate_cents, p.rate_type)}
              {p.adjustments_cents !== 0
                ? ` · ${p.adjustments_cents > 0 ? '+' : ''}${formatMoney(p.adjustments_cents)} adjustments`
                : ''}
            </Text>
          </>
        ) : null}
      </Card>

      {/* "Paid in {month}" needs a payments ledger the server does not have yet
          (V2_ROADMAP.md, MOBILE_BACKEND_NEEDS.md). The row keeps its place instead of
          showing a number nobody can stand behind. */}
      <View style={{ marginHorizontal: 16, marginTop: 12 }}>
        <ComingSoonRow icon="payments" label={`Paid in ${monthName}`} feature="Payment history" />
      </View>

      <Card style={{ marginHorizontal: 16, marginTop: 12, paddingHorizontal: 16, paddingVertical: 14, gap: 8 }}>
        <Text size={13} weight="medium">
          Days worked
        </Text>
        <View style={{ flexDirection: 'row' }}>
          {WEEKDAYS.map((w, i) => (
            <Text key={i} size={11} color={colors.faint} style={{ flex: 1, textAlign: 'center' }}>
              {w}
            </Text>
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {Array.from({ length: lead }, (_, i) => (
            <View key={`blank-${i}`} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1
            const key = localISODate(new Date(year, month, day))
            const isToday = key === todayKey
            const didWork = worked.has(key)
            const bg = isToday ? colors.calToday : didWork ? colors.calWorked : 'transparent'
            const fg = isToday ? colors.onCalToday : didWork ? colors.onCalWorked : colors.calOff
            return (
              <View key={key} style={{ width: `${100 / 7}%`, aspectRatio: 1, padding: 2 }}>
                <View
                  accessibilityLabel={`${day}${didWork ? ', worked' : ''}${isToday ? ', today' : ''}`}
                  style={{
                    flex: 1,
                    borderRadius: 6,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: bg,
                  }}
                >
                  <Text size={12} weight="medium" color={fg} tabular>
                    {day}
                  </Text>
                </View>
              </View>
            )
          })}
        </View>
        <Text size={12} color={colors.faint} style={{ marginTop: 2 }}>
          Filled days are days you checked in. Today is highlighted.
        </Text>
      </Card>

      <View style={{ height: radius.card }} />
    </Screen>
  )
}
