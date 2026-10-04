// Shared "is this row in the current unpaid cycle" comparison, used by the driver cycle drawer
// (PayrollPage.tsx) for both worked shifts and adjustments.
//
// Where the server puts the cutoff (services/payroll.js summary(), from = paid_through_at):
//  - Shifts: `check_in_at >= paid_through_at`, a full timestamp compare. A shift that started
//    before the cycle was marked paid belongs to the paid cycle.
//  - Adjustments: `work_date >= paid_through_at` with work_date a DATE, so Postgres compares
//    dates. An adjustment dated the same day a cycle is marked paid is NOT in the paid cycle: it
//    carries into the next one. That is the intended behaviour (an adjustment entered on the
//    payday after paying is for the next cycle).
//
// `dateIsh` is a plain date ("work_date", e.g. "2026-09-22") or a full timestamp
// ("check_in_at"). KNOWN MISMATCH, not fixed here (see docs/ACCOUNT_SETTINGS_REPORT.md, task 13):
// `new Date(...)` on a bare date parses as UTC midnight, which is earlier than a same-day
// paid_through_at instant, so this returns false for a same-day adjustment and the drawer's list
// leaves it out while the server's total (adjustments_cents) counts it. Shifts are unaffected.
export function isOnOrAfterCycleStart(dateIsh: string, paidThroughAt: string | null): boolean {
  if (!paidThroughAt) return true
  return new Date(dateIsh) >= new Date(paidThroughAt)
}
