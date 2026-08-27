import { useEffect, useMemo, useState } from 'react'
import { Card } from '../../components/Card'
import { Button } from '../../components/Button'
import { StatusBadge } from '../../components/StatusBadge'

// ============================================================================================
// Parent Dashboard — DESIGN MOCKUP, isolated on purpose (§ Parent Dashboard task).
//
// Everything on this page except the Skip Today's Pickup button is STATIC/FAKE data —
// no real db/api calls. Not imported by App.tsx's real route tree; it lives under
// client/src/mockups/ so it can never end up in a real authenticated user's path by
// accident. It's reachable during this design-review phase only via the temporary
// unauthenticated `/mockup/parent-dashboard` route added to App.tsx — remove that route
// (and this comment block) once the design is approved and this graduates to real data,
// at which point its content should fold into client/src/pages/parent/ParentHomePage.tsx.
//
// I did not receive an actual attached reference image in this session — there's no image
// in the conversation to go on. This follows the task's written description plus this
// codebase's existing "Road & Logistics" design system (index.css's @theme tokens, the same
// Card/Button/StatusBadge components every other real page already uses) for visual
// consistency. Flagging this clearly: please compare against the real Stitch export when
// you're back, this is my best-effort reconstruction from the text spec alone.
//
// The ONE real thing on this page: the Skip Today's Pickup button's eligibility state is
// computed from the real wall clock against a mock scheduled pickup time (not a fake/static
// clock), matching the exact rule from the task. "Confirm" calls the real, tested backend
// endpoint (POST /parent/students/:id/skip-pickup — server/src/services/parentPortal.js) —
// genuinely sends notifications via the app's existing mailer, not a new system. Since this
// mockup has no login flow of its own, it needs a real parent JWT (from logging in for real
// in the main app, same-origin) and a real linked student id to actually succeed — see the
// "Test the real Skip action" panel at the bottom of the Skip card.
// ============================================================================================

const FAKE_STUDENTS = [
  {
    id: 'fake-emma',
    name: 'Emma Johnson',
    company: 'Sunrise Student Transport',
    van: { plate: 'VAN-084', year: 2022, model: 'Ford Transit', color: 'White' },
    driverName: 'Marcus Rodriguez',
    driverPhone: '555-0187',
    etaMinutes: 5,
    pickupActual: '7:52 AM',
    dropoffEstimate: '8:15 AM',
    mockPickupTime: '08:00', // HH:MM — fed into the REAL eligibility rule below
  },
  {
    id: 'fake-liam',
    name: 'Liam Carter',
    company: 'Sunrise Student Transport',
    van: { plate: 'VAN-112', year: 2023, model: 'Mercedes Sprinter', color: 'Blue' },
    driverName: 'Sarah Jenkins',
    driverPhone: '555-0142',
    etaMinutes: 12,
    pickupActual: '7:48 AM',
    dropoffEstimate: '8:20 AM',
    mockPickupTime: '08:05',
  },
]

// Real rule (task spec, verbatim): available until 30 min before scheduled pickup, greyed
// out from then through the school day, available again once afternoon dropoff is done,
// resets daily. Pure function of real time — not hardcoded to a fixed demo state.
function computeSkipEligibility(mockPickupTimeHHMM: string, dropoffCompletedToday: boolean) {
  const now = new Date()
  const [h, m] = mockPickupTimeHHMM.split(':').map(Number)
  const pickup = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0)
  const cutoff = new Date(pickup.getTime() - 30 * 60_000)
  if (now < cutoff) return { eligible: true, label: "Skip Today's Pickup" }
  if (dropoffCompletedToday) return { eligible: true, label: "Skip Today's Pickup" }
  return { eligible: false, label: 'Skip Unavailable — Pickup In Progress' }
}

const TOKEN_KEY = 'saferoute_token' // same key lib/auth.tsx uses, so a real session (if any) is reused

export function ParentDashboardMockup() {
  return (
    <main className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <div>
          <h1 className="text-headline-lg text-primary">My Students</h1>
          <p className="text-body-md text-on-surface-variant">
            Design mockup — vehicle info, timeline, and map below are placeholder data.
          </p>
        </div>

        {FAKE_STUDENTS.map((s) => (
          <StudentSection key={s.id} student={s} />
        ))}

        <ProfileSection />
      </div>
    </main>
  )
}

function StudentSection({ student }: { student: (typeof FAKE_STUDENTS)[number] }) {
  return (
    <Card className="flex flex-col gap-5 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title-lg text-on-surface">{student.name}</h2>
          <p className="text-body-md text-on-surface-variant">{student.company}</p>
        </div>
        <StatusBadge tone="active" label={`In Transit, ${student.etaMinutes} mins away`} pulse />
      </div>

      <VehicleInfo student={student} />
      <TripTimeline student={student} />

      <div className="flex flex-wrap gap-3">
        <SkipPickupButton student={student} />
        <ContactDriverButton name={student.driverName} phone={student.driverPhone} />
      </div>

      <RouteMap />
    </Card>
  )
}

function VehicleInfo({ student }: { student: (typeof FAKE_STUDENTS)[number] }) {
  const rows: Array<[string, string]> = [
    ['Plate', student.van.plate],
    ['Year', String(student.van.year)],
    ['Model', student.van.model],
    ['Color', student.van.color],
    ['Driver', student.driverName],
  ]
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-outline-variant bg-surface-container-low p-4 sm:grid-cols-5">
      {rows.map(([label, value]) => (
        <div key={label}>
          <p className="text-label-md text-on-surface-variant uppercase">{label}</p>
          <p className="text-body-md font-medium text-on-surface">{value}</p>
        </div>
      ))}
    </div>
  )
}

// Checkmark = done, pulsing dot = current, greyed = upcoming — same visual language as the
// reference. Fake data (pickupActual/dropoffEstimate are hardcoded above), "In Transit" is
// always treated as the current step for this mockup's purposes.
function TripTimeline({ student }: { student: (typeof FAKE_STUDENTS)[number] }) {
  const steps = [
    { label: 'Picked Up', time: student.pickupActual, state: 'done' as const },
    { label: 'In Transit', time: null, state: 'current' as const },
    { label: 'Drop-off (est.)', time: student.dropoffEstimate, state: 'upcoming' as const },
  ]
  return (
    <div className="flex flex-col gap-0">
      {steps.map((step, i) => (
        <div key={step.label} className="flex gap-3">
          <div className="flex flex-col items-center">
            {step.state === 'done' ? (
              <span className="material-symbols-outlined flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 !text-[16px] text-white">
                check
              </span>
            ) : step.state === 'current' ? (
              <span className="flex h-6 w-6 items-center justify-center">
                <span className="h-3 w-3 animate-pulse rounded-full bg-primary" />
              </span>
            ) : (
              <span className="flex h-6 w-6 items-center justify-center">
                <span className="h-3 w-3 rounded-full bg-surface-container-highest" />
              </span>
            )}
            {i < steps.length - 1 && <span className="h-8 w-px bg-outline-variant" />}
          </div>
          <div className={`pb-2 ${step.state === 'upcoming' ? 'text-on-surface-variant opacity-60' : 'text-on-surface'}`}>
            <p className="text-body-md font-medium">{step.label}</p>
            {step.time && <p className="text-label-md">{step.time}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

function SkipPickupButton({ student }: { student: (typeof FAKE_STUDENTS)[number] }) {
  const [dropoffCompletedToday, setDropoffCompletedToday] = useState(false)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000) // re-derive eligibility live
    return () => clearInterval(id)
  }, [])
  const { eligible, label } = useMemo(
    () => computeSkipEligibility(student.mockPickupTime, dropoffCompletedToday),
    [student.mockPickupTime, dropoffCompletedToday],
  )

  const [testStudentId, setTestStudentId] = useState('')
  const [testResult, setTestResult] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  async function handleConfirm() {
    setTestResult(null)
    const token = localStorage.getItem(TOKEN_KEY)
    if (!token) {
      setTestResult('Log in as a real parent account in the main app first (same browser/origin), then come back and try again.')
      return
    }
    if (!testStudentId) {
      setTestResult("Enter a real student id linked to your parent account below to test the real notification send.")
      return
    }
    setConfirming(true)
    try {
      const res = await fetch(`/api/parent/students/${testStudentId}/skip-pickup`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await res.json().catch(() => ({}))
      setTestResult(
        res.ok
          ? `Real notification sent to ${data.notified?.length ?? 0} recipients.`
          : `${res.status}: ${data.error ?? 'request failed'}`,
      )
    } catch {
      setTestResult('Network error calling the real API — is the dev server running?')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant={eligible ? 'primary' : 'outline'} disabled={!eligible} className="px-6" onClick={handleConfirm}>
        {confirming ? 'Confirming…' : label}
      </Button>

      {/* Dev-only demo control, mockup-only — not part of the real UI. */}
      <label className="flex items-center gap-2 text-label-md text-on-surface-variant">
        <input type="checkbox" checked={dropoffCompletedToday} onChange={(e) => setDropoffCompletedToday(e.target.checked)} />
        (demo) afternoon dropoff already completed today
      </label>

      <details className="text-label-md text-on-surface-variant">
        <summary className="cursor-pointer">Test the real Skip action against the live API</summary>
        <div className="mt-2 flex flex-col gap-2 rounded-lg border border-outline-variant p-3">
          <input
            type="text"
            placeholder="Real linked student id"
            value={testStudentId}
            onChange={(e) => setTestStudentId(e.target.value)}
            className="h-9 rounded-md border border-outline-variant px-2 text-body-md"
          />
          {testResult && <p>{testResult}</p>}
        </div>
      </details>
    </div>
  )
}

function ContactDriverButton({ name, phone }: { name: string; phone: string }) {
  // A real <button> can't nest inside <a> (invalid HTML) — style the anchor itself to
  // match Button's "outline" variant instead of nesting one inside it.
  return (
    <a
      href={`tel:${phone}`}
      className="inline-flex h-14 items-center justify-center gap-2 rounded-lg border border-outline px-6 text-title-lg font-bold text-on-surface transition-all hover:bg-surface-container active:scale-[0.98]"
    >
      <span className="material-symbols-outlined">call</span>
      Contact {name.split(' ')[0]}
    </a>
  )
}

// TODO(v2): replace with live GPS tracking. This is a static school-to-house route
// illustration for MVP, not a real map or real location data.
function RouteMap() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-label-md text-on-surface-variant uppercase">Route (static)</p>
      <div className="flex items-center justify-between rounded-lg border border-outline-variant bg-surface-container-low p-6">
        <div className="flex flex-col items-center gap-1">
          <span className="material-symbols-outlined text-primary">school</span>
          <span className="text-label-md">School</span>
        </div>
        <div className="mx-2 h-px flex-1 border-t-2 border-dashed border-outline" />
        <div className="flex flex-col items-center gap-1">
          <span className="material-symbols-outlined text-primary">home</span>
          <span className="text-label-md">Home</span>
        </div>
      </div>
      <p className="text-label-md text-on-surface-variant">TODO: live GPS tracking (v2) — see task backlog.</p>
    </div>
  )
}

// Read-only, username only — no password/email edit here (task: self-service edit for
// driver/parent/staff is intentionally admin-only for now, TODO v2).
function ProfileSection() {
  return (
    <Card className="flex flex-col gap-2 p-5">
      <h2 className="text-title-lg text-on-surface">Profile</h2>
      <p className="text-body-md text-on-surface-variant">Username</p>
      <p className="text-body-lg text-on-surface">jamie.parent@example.com</p>
      <p className="text-label-md text-on-surface-variant">
        TODO (v2): self-service password/email change. Currently intentional: only the admin who created your
        account can edit it. TODO (v2): 2FA / signup verification.
      </p>
    </Card>
  )
}
