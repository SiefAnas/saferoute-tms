# Backlog

Deferred items surfaced during implementation. Spec §9 already tracks the broader v2 list
(reporting, notifications system, billing, branding, photos, van maintenance); this file is
for things noticed while building that aren't in the spec's own backlog.

## From the Step 3 claim-slice review (deferred, agreed)
- **`resendVerification` hygiene** — issues a new token without invalidating prior ones
  (multiple valid tokens can coexist) and doesn't confirm an active pending claim exists.
- **`searchClaimable` is unauthenticated + unthrottled** — placeholder-name enumeration / DoS
  surface. Add rate limiting (a general MVP gap, not just here).
- **No input validation** — email format, password strength, field lengths. Add a cross-cutting
  validation layer.
- **`email_verified_at` semantics are overloaded** — for fresh signups it means "verification
  waived," not "email proven." Document or normalize.
- **Defense-in-depth on claim finalize** — beyond the `requireOperable` fix, consider
  deactivating losing pending-claimants when a claim is finalized.

## Remaining Step 3 slices (build order, on hold pending review)
- **Placeholder-creation endpoints** — the other side creating stubs (company_admin → school
  stub, school_admin → company stub); wire the creator edit-rights guard into that flow.
- **Resource routes** — Users, Sessions, Trips (two-way confirmation + 5-min auto-complete),
  Assignments, PayRules.
- **`school_staff` "granted-students-only" sub-scope** — needs a subquery against
  `staff_student_access`; apply in the student/trip routes when built.

## Hardening (post-MVP or as time allows)
- **Postgres RLS** as belt-and-suspenders on top of the app-layer scoped accessor.
- **Real email transport** (SMTP / provider) to replace the dev mailer.
- **Persistent local Postgres** (Docker or hosted) so the dev server can actually run
  DB-backed routes; embedded Postgres is currently test-only.
