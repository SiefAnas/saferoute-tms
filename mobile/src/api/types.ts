// Response shapes for the endpoints the driver and parent apps call. Narrowed from
// client/src/types/api.ts to just those, and checked against server/src/services/*.js.
// See API_CONTRACT.md §3 (driver) and §4 (parent).

export type Role = 'driver' | 'parent' | 'company_admin' | 'school_admin' | 'school_staff'
export type TenantType = 'company' | 'school'

// POST /auth/login → `user`.
export interface AuthUser {
  id: string
  email: string
  full_name: string
  role: Role
  tenantType: TenantType
  tenantId: string
  // True while the account is on a temporary password (new, or reset by the admin): the app
  // must send the user to "set your password" first; the API refuses everything else
  // (403 PASSWORD_CHANGE_REQUIRED) until they do. API_CONTRACT.md "Auth".
  must_change_password?: boolean
}

export interface LoginResponse {
  token: string
  user: AuthUser
}

// GET /auth/me → a different shape from login's user (API_CONTRACT.md §2). Used only to
// prove a stored token is still good on app start.
export interface MeResponse {
  user: {
    userId: string
    role: Role
    tenantType: TenantType
    tenantId: string
    orgClaimStatus: string | null
    emailVerifiedAt: string | null
  }
}

export type ShiftPeriod = 'morning' | 'afternoon'
// 'both' = one driver does the full day for this student.
export type AssignmentShiftPeriod = ShiftPeriod | 'both'

export interface DriverSession {
  id: string
  user_id: string
  company_id: string
  // null on sessions from before the morning/afternoon split; still has to be closable.
  shift_period: ShiftPeriod | null
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
  shift_period: ShiftPeriod | null
  driver_confirmed_at: string | null
  staff_confirmed_at: string | null
  status: TripStatus
  auto_completed: boolean
  completed_at: string | null
  created_at: string
  updated_at: string
  driver_name: string | null
  driver_phone: string | null
}

export interface Assignment {
  id: string
  company_id: string
  student_id: string
  driver_user_id: string
  van_id: string
  start_date: string // Postgres DATE: "2026-09-23T00:00:00.000Z" — read the first 10 chars
  end_date: string | null
  shift_period: AssignmentShiftPeriod
  pickup_time: string | null // "HH:MM:SS"
  dropoff_time: string | null
  created_at: string
  updated_at: string
}

// GET /schedule/today
export interface TodayScheduleItem {
  assignment_id: string
  shift_period: AssignmentShiftPeriod
  pickup_time: string | null
  dropoff_time: string | null
  student: { id: string; name: string; grade: string | null; parent_name: string | null; parent_phone: string | null }
  school: { id: string; name: string }
  // null when there is no change today. Effective time = override time ?? usual time.
  override: { pickup_time: string | null; dropoff_time: string | null; skip: boolean; note: string | null } | null
  // Per shift, since a 'both' assignment can have independent morning/afternoon outcomes.
  parent_skipped: { morning: boolean; afternoon: boolean }
  no_show_reported: { morning: boolean; afternoon: boolean }
}

export interface StudentContact {
  id: string
  student_id: string
  name: string
  phone: string | null
  relationship: string | null
  created_at: string
}

export interface Student {
  id: string
  company_id: string
  school_id: string
  full_name: string
  grade: string | null
  age: number | null
  parent_name: string | null
  parent_phone: string | null
  street_address: string | null
  city: string | null
  state: string | null
  zip_code: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Only on GET /students/:id, not on the list endpoint.
  contacts?: StudentContact[]
}

export interface Van {
  id: string
  company_id: string
  number: string | null
  license_plate: string
  brand: string
  model: string
  year: number
  color: string | null
  created_at: string
  updated_at: string
}

// GET /schools/:id as a driver sees it.
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

export type RateType = 'hourly' | 'daily'

// GET /payroll/summary/:driverId
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

// ── Parent ──────────────────────────────────────────────────────────────────

// GET /parent/me
export interface ParentProfile {
  full_name: string
  email: string
  phone: string | null
  address: string | null
}

export interface ParentTransportEntry {
  shift_period: AssignmentShiftPeriod
  van: {
    number: string | null
    license_plate: string
    brand: string
    model: string
    year: number
    color: string | null
  } | null
  driver: { full_name: string; phone: string | null } | null
  pickup_time: string | null
  dropoff_time: string | null
}

// GET /parent/students/:id/detail
export interface ParentStudentDetail {
  student: { id: string; full_name: string; grade: string | null }
  school: { name: string | null }
  company: { name: string | null; phone: string | null }
  // One entry per active assignment — two when morning and afternoon differ.
  transport: ParentTransportEntry[]
  skip_today: boolean
  trips_today: {
    trip_type: TripType
    status: TripStatus
    driver_confirmed_at: string | null
    staff_confirmed_at: string | null
    completed_at: string | null
    created_at: string
  }[]
}

// GET /parent/students/:id/skip-status — the server owns this decision. A split student
// (separate morning + afternoon assignments) gets a morning-only vs whole-day choice.
export type SkipStatus =
  | {
      splitShift: true
      morningOnly: { eligible: boolean; alreadySkipped: boolean }
      wholeDay: { eligible: boolean; alreadySkipped: boolean }
      pickupTime: string | null
    }
  | {
      splitShift: false
      eligible: boolean
      reason: string | null
      pickupTime: string | null
      alreadySkipped: boolean
    }

export interface SkipPickupResponse {
  skipped: boolean
  notified: string[]
}
