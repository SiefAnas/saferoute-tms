import type { SigninReminderDriver } from '@/api/types'

// Pure helpers for the sign-in reminder settings (unit tested).
export const SIGNIN_CHOICES = [15, 20, 30, 40, 45, 60]

// One line on what this driver gets.
export function signinSummary(d: Pick<SigninReminderDriver, 'mode' | 'effective_minutes'>): string {
  if (d.effective_minutes === null) return d.mode === 'off' ? 'Off for this driver.' : 'No sign-in reminder.'
  const whose = d.mode === 'custom' ? 'Own timing: ' : 'Company default: '
  return `${whose}${d.effective_minutes} minutes before the first stop of each run.`
}
