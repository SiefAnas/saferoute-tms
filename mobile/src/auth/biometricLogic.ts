// The rules for biometric unlock, kept free of React Native so they can be tested in plain Node.
//
// How it works: after a password sign-in the user can turn on Face ID (iPhone) or fingerprint /
// face (Android). The login token from that sign-in is then kept in the phone's secure storage
// behind the biometric lock, and each time the app opens a successful scan unlocks it. The
// password is never saved. The token lasts 12 hours with no refresh (API_CONTRACT.md §2), so
// once it has expired the scan can't help and the user types the password again.

// Every 90 days the password has to be typed again, even when the scan works.
export const PASSWORD_MAX_AGE_DAYS = 90
export const PASSWORD_MAX_AGE_MS = PASSWORD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

// True when the last typed-password sign-in is missing, unreadable or 3 months old or more.
export function passwordLoginDue(lastPasswordLoginAt: number | null, now: number): boolean {
  if (lastPasswordLoginAt === null || !Number.isFinite(lastPasswordLoginAt)) return true
  return now - lastPasswordLoginAt >= PASSWORD_MAX_AGE_MS
}

export type UnlockPlan =
  // Biometric is on and the password is recent: show the scan.
  | { kind: 'biometric' }
  // Type the password. `notice` says why, when there is something to say.
  | { kind: 'password'; notice: string | null }

export function unlockPlan(input: {
  biometricEnabled: boolean
  // A token is locked behind the scan (not signed out, not rejected by the server).
  tokenSaved: boolean
  biometricAvailable: boolean
  lastPasswordLoginAt: number | null
  now: number
  label: string
}): UnlockPlan {
  if (!input.biometricEnabled || !input.tokenSaved) return { kind: 'password', notice: null }
  if (!input.biometricAvailable) {
    return { kind: 'password', notice: `${input.label} is not set up on this phone. Sign in with your password.` }
  }
  if (passwordLoginDue(input.lastPasswordLoginAt, input.now)) {
    return { kind: 'password', notice: PASSWORD_DUE_MESSAGE }
  }
  return { kind: 'biometric' }
}

export const PASSWORD_DUE_MESSAGE = 'For your security, enter your password. We ask for it once every 90 days.'

export const TOKEN_EXPIRED_MESSAGE = 'Your sign-in has expired. Enter your password to continue.'

// What the platform calls it. iPhone: Face ID. Android: fingerprint or face, whichever the phone has.
export function biometricLabel(platform: string): string {
  return platform === 'ios' ? 'Face ID' : 'fingerprint or face'
}

// Sentence-start form for buttons and titles ("Fingerprint or face", "Face ID").
export function biometricTitle(platform: string): string {
  const label = biometricLabel(platform)
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export type UnlockFailure = 'cancelled' | 'failed' | 'missing'

export function unlockFailureMessage(reason: UnlockFailure, label: string): string {
  switch (reason) {
    case 'cancelled':
      return `Sign in with your password, or try ${label} again.`
    case 'failed':
      return `${label} didn't work. Sign in with your password, or try again.`
    case 'missing':
      // New phone, a restored backup, or the phone's fingerprints / face changed.
      return `${label} needs to be turned on again on this phone. Sign in with your password first.`
  }
}
