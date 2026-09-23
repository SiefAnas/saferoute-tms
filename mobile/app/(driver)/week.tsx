import { useEffect } from 'react'
import { useRouter } from 'expo-router'
import { Screen } from '@/components/Screen'
import { SectionHeader } from '@/components/Card'
import { EmptyState } from '@/components/States'
import { useComingSoon } from '@/components/Dialogs'

// Week tab. The design wants a card per weekday with each day's students, times and override
// notes, but the only schedule endpoint that exists is GET /schedule/today — a week view needs
// GET /schedule/week?from=YYYY-MM-DD (V2_ROADMAP.md, and MOBILE_BACKEND_NEEDS.md). Rather than
// invent a week out of one day of data, the tab opens the shared Coming soon dialog (the same
// behaviour as the web app's /driver/week) and points the driver back at Today.
export default function WeekScreen() {
  const router = useRouter()
  const openComingSoon = useComingSoon()

  useEffect(() => {
    openComingSoon('The week schedule')
  }, [openComingSoon])

  return (
    <Screen>
      <SectionHeader title="This week" />
      <EmptyState
        icon="calendar-view-week"
        title="The week view is coming soon"
        body="Only today's schedule is available right now — including any time change or skip the office set for today. Monday to Friday at a glance needs a new endpoint on the server."
        action={{ label: "See today's schedule", onPress: () => router.replace('/(driver)/today') }}
      />
    </Screen>
  )
}
