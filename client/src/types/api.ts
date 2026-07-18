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
