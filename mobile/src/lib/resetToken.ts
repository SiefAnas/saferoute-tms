// The reset link in the "reset your password" email ends in ?token=<64 hex characters>. On the
// phone the user can paste the whole link, or just the code, into the app; this pulls the token
// out of either. Returns null if there is no plausible token.
export function extractResetToken(input: string | null | undefined): string | null {
  const text = (input ?? '').trim()
  if (!text) return null
  const fromLink = /[?&]token=([0-9a-fA-F]{32,128})/.exec(text)
  if (fromLink?.[1]) return fromLink[1].toLowerCase()
  if (/^[0-9a-fA-F]{32,128}$/.test(text)) return text.toLowerCase()
  return null
}
