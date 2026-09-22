// Shared "is this row in the current unpaid cycle" comparison, used by
// DriverCycleDetailModal (PayrollPage.tsx) for both worked shifts and adjustments. Pulled
// out into its own testable function after a real bug: the adjustments filter used to
// compare `a.work_date >= paidThroughAt.slice(0, 10)` (date-string only), so a same-day
// adjustment still showed under the new cycle even though the server's own timestamp
// compare had already excluded it from the dollar total. Comparing full Date values here
// matches the server exactly and keeps this list in sync with base_pay_cents/adjustments_cents.
//
// `dateIsh` is a plain date ("work_date", e.g. "2026-09-22") or a full timestamp
// ("check_in_at"); `new Date(...)` on a bare date parses as UTC midnight, which is the
// correct "start of that day" boundary to compare against a paid_through_at instant.
export function isOnOrAfterCycleStart(dateIsh: string, paidThroughAt: string | null): boolean {
  if (!paidThroughAt) return true
  return new Date(dateIsh) >= new Date(paidThroughAt)
}
