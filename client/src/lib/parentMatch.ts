import type { PublicUser, Student } from '../types/api'

// Parent <-> Student match suggestion (§ auto-match task, 2026-09-01) — purely advisory, never
// auto-links anything. Compares the guardian info captured on a Student record (parent_name/
// parent_phone/street_address+city+state+zip) against existing Parent accounts (full_name/
// phone/address) to suggest "this might be the same person," so an admin can confirm instead
// of re-typing a link by hand. Runs entirely client-side — both pages already have the full
// parents/students lists loaded, and this never writes anything by itself.
//
// SENSITIVITY, documented per request so this can be retuned later without re-deriving it:
//   - Phone match (weight 3): last 7-10 digits equal after stripping all non-digits. Treated
//     as a strong signal alone — two different families essentially never share a phone
//     number, and formatting differences (dashes, parens, country code) are normalized away.
//   - Name match (weight 1): normalized (lowercased, punctuation stripped) exact match, one
//     name containing the other (handles a middle name/initial), or >=82% similarity by
//     Levenshtein ratio. Weak alone — common names collide (the seed data alone has two
//     "Sullivan" families) — only counts when corroborated by another signal.
//   - Street-address match (weight 2): the parent's free-text address field is split on the
//     first comma into a "street" part; compared against the student's structured
//     street_address at >=75% similarity (deliberately more forgiving than name, since
//     "St" vs "Street" / minor formatting differences are common). Weak alone too: the seed
//     data's dummy street pool is intentionally reused across multiple unrelated students, so
//     an address-only match would false-positive across the whole seeded dataset.
//   - Suggestion threshold: total score >= 3. This means phone alone qualifies; name+address
//     together qualifies (1+2); name alone or address alone does not. Adjust MATCH_THRESHOLD
//     and the per-signal weights below to change sensitivity.
const WEIGHTS = { phone: 3, name: 1, address: 2 } as const
export const MATCH_THRESHOLD = 3

function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[.,#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePhone(s: string | null | undefined): string {
  return (s ?? '').replace(/\D/g, '')
}

// Classic Levenshtein edit distance -> similarity ratio in [0, 1] (1 = identical).
function similarity(a: string, b: string): number {
  if (!a && !b) return 1
  if (!a || !b) return 0
  const m = a.length
  const n = b.length
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    let prevDiag = dp[0]
    dp[0] = i
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, dp[j], dp[j - 1])
      prevDiag = temp
    }
  }
  const distance = dp[n]
  return 1 - distance / Math.max(m, n)
}

function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeText(a)
  const nb = normalizeText(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (na.includes(nb) || nb.includes(na)) return true
  return similarity(na, nb) >= 0.82
}

function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = normalizePhone(a)
  const pb = normalizePhone(b)
  if (pa.length < 7 || pb.length < 7) return false
  const tailLen = Math.min(10, pa.length, pb.length)
  return pa.slice(-tailLen) === pb.slice(-tailLen)
}

// The parent's `address` is one free-text field (matches the driver/school convention);
// the student's is structured. Take everything before the first comma as the parent's
// "street" part and compare it to the student's street_address.
function streetPart(address: string | null | undefined): string {
  return normalizeText((address ?? '').split(',')[0])
}

function addressesMatch(studentStreet: string | null | undefined, parentAddress: string | null | undefined): boolean {
  const sStreet = normalizeText(studentStreet)
  const pStreet = streetPart(parentAddress)
  if (!sStreet || !pStreet) return false
  if (sStreet === pStreet) return true
  return similarity(sStreet, pStreet) >= 0.75
}

export interface ParentMatchResult {
  parent: PublicUser
  score: number
  signals: string[]
}

type GuardianLike = Pick<Student, 'parent_name' | 'parent_phone' | 'street_address'>

// Scores one student/parent pair. Exported (not just findBestParentMatch) so the Parents
// page can call it per-row to decide whether to highlight, without needing a "best of many"
// scan.
export function scoreParentMatch(student: GuardianLike, parent: PublicUser): { score: number; signals: string[] } {
  let score = 0
  const signals: string[] = []
  if (phonesMatch(student.parent_phone, parent.phone)) {
    score += WEIGHTS.phone
    signals.push('Phone number matches')
  }
  if (namesMatch(student.parent_name, parent.full_name)) {
    score += WEIGHTS.name
    signals.push('Name is similar')
  }
  if (addressesMatch(student.street_address, parent.address)) {
    score += WEIGHTS.address
    signals.push('Address is similar')
  }
  return { score, signals }
}

// Best-scoring candidate parent for a student, excluding any parent id in `excludeIds`
// (already linked). Returns null if nothing clears MATCH_THRESHOLD.
export function findBestParentMatch(student: GuardianLike, parents: PublicUser[], excludeIds: Set<string>): ParentMatchResult | null {
  let best: ParentMatchResult | null = null
  for (const parent of parents) {
    if (excludeIds.has(parent.id)) continue
    const { score, signals } = scoreParentMatch(student, parent)
    if (score < MATCH_THRESHOLD) continue
    if (!best || score > best.score) best = { parent, score, signals }
  }
  return best
}
