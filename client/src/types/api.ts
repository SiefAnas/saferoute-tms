// Types mirror the API's actual response shapes (server/src/services/*.js), not aspirational
// ones — see individual routes for the source of truth.

export type Role = 'driver' | 'company_admin' | 'school_admin' | 'school_staff' | 'parent'
export type TenantType = 'company' | 'school'

// Shape returned by POST /auth/login's `user` field.
export interface AuthUser {
  id: string
  email: string
  full_name: string
  role: Role
  tenantType: TenantType
  tenantId: string
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

export type OrgKind = 'company' | 'school'

// GET /signup/:kind/claimable — minimal fields only, no creator identity (§5.3).
export interface ClaimCandidate {
  id: string
  name: string
  address: string | null
  addedByPartner: true
}

// POST /signup/:kind response is a union: a fresh org is immediately operational
// (§5.2); a claim is pending until the claimant verifies their email (§5.3). NOTE:
// the 'created' shape's `user` is intentionally NOT the same as AuthUser (no
// full_name/tenantType/tenantId) — callers should follow up with a real login()
// rather than trying to synthesize a full session from this alone.
export type SignupResponse =
  | { mode: 'created'; token: string; user: { id: string; email: string; role: Role } }
  | { mode: 'pending_claim'; userId: string; email: string }

export interface VerifyEmailResponse {
  verified: boolean
  claimFinalized: boolean
}

export interface PublicUser {
  id: string
  email: string
  full_name: string
  role: Role
  phone: string | null
  address: string | null
  license_number: string | null
  is_active: boolean
  email_verified_at: string | null
  created_by_user_id: string | null
}

// Which parent can see which student, granted by a company_admin — the company-side
// counterpart to StaffAccessGrant (§7.3), since parent is a company-scoped role.
export interface ParentStudentLink {
  id: string
  parent_user_id: string
  student_id: string
  company_id: string
  created_by_user_id: string | null
  created_at: string
}

// GET /parent/students/:id/skip-status — server-authoritative eligibility for the real
// Skip Today's Pickup action (§ Parent Dashboard task).
export interface SkipStatus {
  eligible: boolean
  reason: string | null
  pickupTime: string | null
  alreadySkipped: boolean
}

// GET /parent/students/:id/detail — real vehicle/driver/trip info for the parent
// dashboard's real (non-mockup) view (added 2026-08-27).
export interface ParentStudentDetail {
  student: { id: string; full_name: string }
  school: { name: string | null }
  company: { name: string | null }
  van: { license_plate: string; brand: string; model: string; year: number; color: string | null } | null
  driver: { full_name: string; phone: string | null } | null
  pickup_time: string | null
  dropoff_time: string | null
  skip_today: boolean
  trips_today: Array<{
    trip_type: TripType
    status: TripStatus
    driver_confirmed_at: string | null
    staff_confirmed_at: string | null
    completed_at: string | null
    created_at: string
  }>
}

export interface Van {
  id: string
  company_id: string
  license_plate: string
  brand: string
  model: string
  year: number
  // Nullable at the DB level (existing vans predate these fields) even though the create
  // form requires them going forward — see server/src/routes/vans.js.
  color: string | null
  created_at: string
  updated_at: string
}

export interface Student {
  id: string
  company_id: string
  school_id: string
  full_name: string
  grade: string | null
  parent_name: string | null
  parent_phone: string | null
  age: number | null
  // Home address split into structured fields (2026-08-27) — replaces the old free-text
  // `address` column, which real data never populated. Nullable at the DB level (existing
  // students predate these fields) even though the create form requires them going forward.
  street_address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Only present on GET /students/:id (merged server-side), not on the list endpoint.
  contacts?: StudentContact[]
}

// Additional contacts beyond the student's primary parent_name/parent_phone.
export interface StudentContact {
  id: string
  company_id: string
  school_id: string
  student_id: string
  name: string
  phone: string | null
  relationship: string | null
  created_at: string
}

export interface DriverSession {
  id: string
  user_id: string
  company_id: string
  check_in_at: string
  check_out_at: string | null
  check_in_lat: string | null
  check_in_lng: string | null
  check_out_lat: string | null
  check_out_lng: string | null
  duration_minutes: number | null
  trip_count: number
  created_at: string
  updated_at: string
}

export type TripType = 'pickup' | 'dropoff'
export type TripStatus = 'pending' | 'complete'

export interface Trip {
  id: string
  session_id: string
  company_id: string
  school_id: string
  student_id: string
  trip_type: TripType
  driver_confirmed_at: string | null
  staff_confirmed_at: string | null
  status: TripStatus
  auto_completed: boolean
  completed_at: string | null
  created_at: string
  updated_at: string
  // Enriched server-side (name/phone only — no email/other PII) so school_staff can see
  // who they're handing a student to/from (§7.4). Always present on GET responses.
  driver_name: string | null
  driver_phone: string | null
}

export interface Assignment {
  id: string
  company_id: string
  student_id: string
  driver_user_id: string
  van_id: string
  start_date: string
  end_date: string | null
  pickup_time: string | null // "HH:MM:SS", Postgres time formatting
  dropoff_time: string | null
  created_at: string
  updated_at: string
}

// A single day's exception on an assignment's usual pickup/dropoff time — a different
// time and/or a full skip. Not a recurring weekly pattern (deferred to V2).
export interface ScheduleOverride {
  id: string
  company_id: string
  assignment_id: string
  override_date: string
  pickup_time: string | null
  dropoff_time: string | null
  skip: boolean
  note: string | null
  created_at: string
  updated_at: string
}

// GET /schedule/today — a driver's active assignments for today, enriched with
// student/school summaries and today's resolved override (if any).
export interface TodayScheduleItem {
  assignment_id: string
  pickup_time: string | null
  dropoff_time: string | null
  student: {
    id: string
    name: string
    grade: string | null
    parent_name: string | null
    parent_phone: string | null
  }
  school: { id: string; name: string }
  override: { pickup_time: string | null; dropoff_time: string | null; skip: boolean; note: string | null } | null
  // Added alongside the driver no-show feature: lets the driver's schedule view show
  // "parent already skipped this pickup" and reflect an already-reported no-show.
  parent_skipped_today: boolean
  no_show_reported_today: boolean
}

export type RateType = 'hourly' | 'daily'

export interface PayRule {
  id: string
  driver_id: string
  company_id: string
  rate_type: RateType
  rate_cents: number
  // Added 2026-08-27 for the Payroll "Paid" feature — null = never marked paid (everything
  // since the beginning is owed, same as summary()'s default with no `from`).
  paid_through_at: string | null
  created_at: string
  updated_at: string
}

export interface PaySummary {
  driver_id: string
  rate_type: RateType
  rate_cents: number
  worked_minutes: number
  worked_days: number
  base_pay_cents: number
  adjustments_cents: number
  total_pay_cents: number
}

// GET /payroll/unpaid-summary/:driverId — PaySummary plus the cycle boundary it was computed
// against, for the Payroll page's "Amount Owed" column + "Paid" button.
export interface UnpaidPaySummary extends PaySummary {
  paid_through_at: string | null
}

export interface PayAdjustment {
  id: string
  driver_id: string
  company_id: string
  amount_cents: number
  note: string
  work_date: string
  created_at: string
  updated_at: string
}

// Which School Staff member can see which student, granted by a School Admin (§7.3).
export interface StaffAccessGrant {
  id: string
  staff_user_id: string
  student_id: string
  school_id: string
  granted_by_user_id: string | null
  created_at: string
}

export interface Company {
  id: string
  name: string
  address: string | null
  zip_code: string | null
  state: string | null
  claim_status: 'claimed' | 'unclaimed' | 'pending_claim'
  created_by_user_id: string | null
}

export interface School {
  id: string
  name: string
  address: string | null
  zip_code: string | null
  state: string | null
  phone: string | null
  hours: string | null
  website: string | null
  claim_status: 'claimed' | 'unclaimed' | 'pending_claim'
  created_by_user_id: string | null
}

// GET /schools/:id (company_admin/driver) — a narrower shape than the full School row
// (no claim_status/created_by_user_id, since the caller isn't the school's own tenant).
export interface SchoolDetail {
  id: string
  name: string
  address: string | null
  zip_code: string | null
  state: string | null
  phone: string | null
  hours: string | null
  website: string | null
}

// GET /schools (BACKLOG #7) — company_admin-only, id+name only, scoped to schools the
// caller's company already has a student at. Not the full School shape above.
export interface SchoolSummary {
  id: string
  name: string
}

// GET /dashboard/absent-today — today's real skip/no-show signals (2026-08-28 Dashboard
// redesign), resets daily since both source tables are keyed by calendar date.
export interface AbsentTodayEntry {
  student_id: string
  student_name: string
  type: 'parent_skipped' | 'driver_no_show'
  at: string
}

// GET /payroll/summary/company — company-wide payroll snippet for the Dashboard.
export interface CompanyPayrollSummary {
  driver_count: number
  total_minutes: number
  total_pay_cents: number
}
