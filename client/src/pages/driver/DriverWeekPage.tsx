import { SectionHeader } from '../../components/mobile'
import { ComingSoonCard } from '../../components/ComingSoon'

// Driver app, Week tab (design 3a). V2: a real week needs GET /schedule/week (each day's
// schedule with that day's overrides and skips applied). Until it exists this shows Coming Soon
// rather than the usual schedule dressed up as the real week. See V2_ROADMAP.md.
// The tab itself opens the Coming Soon dialog; this page only shows for a direct link.
export function DriverWeekPage() {
  return (
    <>
      <SectionHeader title="This week" />
      <div className="mx-4">
        <ComingSoonCard title="The week schedule" body="Today's schedule, with any changes, is on the Today tab." />
      </div>
    </>
  )
}
