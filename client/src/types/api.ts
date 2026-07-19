// Types mirror the API's actual response shapes (server/src/services/*.js), not aspirational
// ones — see individual routes for the source of truth.

export type Role = 'driver' | 'company_admin' | 'school_admin' | 'school_staff'
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
  is_active: boolean
  email_verified_at: string | null
}

export interface Van {
  id: string
  company_id: string
  license_plate: string
  model: string | null
  year: number | null
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
  created_at: string
  updated_at: string
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
  created_at: string
  updated_at: string
}

export type RateType = 'hourly' | 'daily'

export interface PayRule {
  id: string
  driver_id: string
  company_id: string
  rate_type: RateType
  rate_cents: number
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
  claim_status: 'claimed' | 'unclaimed' | 'pending_claim'
  created_by_user_id: string | null
}

export interface School {
  id: string
  name: string
  address: string | null
  claim_status: 'claimed' | 'unclaimed' | 'pending_claim'
  created_by_user_id: string | null
}

// GET /schools (BACKLOG #7) — company_admin-only, id+name only, scoped to schools the
// caller's company already has a student at. Not the full School shape above.
export interface SchoolSummary {
  id: string
  name: string
}
