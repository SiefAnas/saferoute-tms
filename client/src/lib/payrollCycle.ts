// "Is this row in the current unpaid cycle" comparisons for the driver cycle drawer
// (PayrollPage.tsx). They must use exactly the boundaries the server uses for the owed total
// (services/payroll.js unpaidSummary), so the listed lines always add up to it:
//  - Shifts: check_in_at >= paid_through_at, a full timestamp compare. A shift that started
//    before the cycle was marked paid belongs to the paid cycle.
//  - Adjustments: work_date >= adjustments_from, a calendar-date compare. adjustments_from is the
//    day the cycle was marked paid, computed by the server, so an adjustment dated that day is in
//    the new cycle. Never derive it here from paid_through_at: the browser's time zone can name a
//    different day than the server's.
//
// No imports: the server's payroll suite imports this file directly to check the sums.

// `timestamp` is a full timestamp such as a session's check_in_at.
export function isOnOrAfterCycleStart(timestamp: string, paidThroughAt: string | null): boolean {
  if (!paidThroughAt) return true
  return new Date(timestamp) >= new Date(paidThroughAt)
}

// `workDate` is an adjustment's work_date ("2026-09-22" or "2026-09-22T00:00:00.000Z");
// `adjustmentsFrom` is unpaid-summary's adjustments_from ("2026-09-22"), null if never paid.
export function isAdjustmentInCycle(workDate: string, adjustmentsFrom: string | null): boolean {
  if (!adjustmentsFrom) return true
  return workDate.slice(0, 10) >= adjustmentsFrom
}
