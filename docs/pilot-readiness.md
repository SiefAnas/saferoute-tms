# Pilot readiness: real company, real children

Date: 2026-09-30. Code: `origin/main` at `47dd95c`, plus the unmerged branches and the other reports
in `docs/`. Report only. Blunt, as asked. Ranked by risk to children and their data, then to the business.

**Bottom line: not ready yet.** The core product works and is well tested. What's missing is
mostly *around* the code: security fixes still sitting on branches, legal groundwork, how
production is run, and how drivers learn about changes in time. Items 1–6 should block a pilot
with real children. Items 7–12 should be fixed in the first weeks. The rest can wait.

## Blockers
### 1. Production is open to two known data leaks right now
The placeholder-claim takeover (anyone can become a school's admin and read every attached child's
name, home address and parent phone) and the "student at any school" hole are **fixed only on
branches** (`fix-placeholder-claim`, `fix-student-school-scope`). `main`, and so presumably
production, still has both. The first needs no account at all.
**Do:** merge steps 1–3 of docs/merge-plan.md and deploy before anything else.
**Also check:** whether any placeholder was already claimed by a stranger. Look for schools or
companies with `claim_status = 'claimed'` whose admin wasn't created by you, and at who ran any
claim through verify-email.

### 2. No legal or privacy groundwork for children's data
There is no privacy policy, no terms, and no consent flow in the web or mobile app. There is no
data processing agreement with schools, and no record of what parents agreed to. The system stores:
- minors' names, ages, grades and home addresses;
- guardian phones;
- free-text notes that already invite health information ("needs help buckling");
- daily pickup and drop-off times (and GPS at check-in).

US school data comes with obligations: FERPA through the schools, COPPA considerations for the
under-13s, and state student-privacy laws.
**Do:** privacy policy + terms, a DPA template for schools, a parent notice, and a retention
policy, reviewed by a lawyer, before real children are entered.

### 3. Production schema is managed by hand, and its current state is unverified
Migration 025 was missed once already. Four more (026–029) are waiting. Nothing checks at boot
that the database matches the code.
**Do:** docs/migration-deploy-options.md Option E (a `/health` that fails when migrations are
pending), then Pre-Deploy migrations. Before the pilot, confirm on Neon which migrations are
applied.

### 4. Timezone: "today" and pickup cutoffs probably use UTC
- All "today" logic (schedules, the parent's skip-pickup cutoff, no-shows, pay days) uses Postgres
  `CURRENT_DATE` / `now()` in the **database's session timezone**. There is no per-school or
  per-company timezone. `pickup_time` is a bare `time`.
- Neon's default is UTC. If production is UTC, a 7:30 pickup is treated as 7:30 UTC (3:30 AM in
  Boston), so the parent skip cutoff is hours early. "Today" also flips at 8 PM Eastern (the code
  already has a comment about one such bug).
- I couldn't check production (no remote access in this session).

**Do:** run `SHOW timezone;` on Neon. If it's UTC, set `ALTER DATABASE … SET timezone = 'America/New_York'`
(single-region pilot), then test skip-pickup the evening before and at 7 AM.

### 5. Children's data is copied daily into GitHub, unencrypted, for 90 days
`.github/workflows/db-backup.yml` uploads a full `pg_dump` as an Actions artifact. Anyone with read
access to the repo can download every child's record. There is no encryption and no evidence a
restore was ever tested.
**Do:** encrypt the dump before upload (e.g. `age` with a key kept off GitHub), or send it to a
private bucket. Restrict repo access. Do one real restore to a scratch Neon branch and write the
steps down.

### 6. Drivers don't reliably learn about changes in time
- A parent skip, a school's "left early" or "staying later", or an admin's override reaches the
  driver only by **email**, plus whatever the app shows the next time the driver refreshes.
- There are **no push notifications and no auto-refresh** (docs/failure-modes.md). A skip at 6:55
  for a 7:30 pickup may never be seen in time, so the driver waits at an empty house (or worse,
  the reverse on a "left early" day).

**Do, before a pilot:**
- auto-refresh the driver's Today screen every 30–60 s while a shift is open;
- a visible "changed since you last looked" banner;
- then push notifications (Expo push) as the next step.

## Fix in the first weeks
### 7. Custody records can say "complete" when nobody confirmed
A pending drop-off auto-completes after 5 minutes and only emails admins. On top of that, lost
responses can log trips twice, so false "not confirmed" alerts go out (docs/failure-modes.md #2),
and the school pickup screen doesn't refresh on its own (#4). For a child-safety product, the
record of who had the child must be trustworthy.
**Do:** idempotent trip logging plus one trip per session, student and type; auto-refresh the
school screen; decide whether auto-complete should exist at all, or only flag the trip.

### 8. No automated tests on pull requests
The only workflow is the backup. The ~30 suites and 94 mobile tests run only when someone runs
them by hand, and PRs have been merged without them. On Windows the suites are also flaky
(leftover Postgres processes).
**Do:** a GitHub Actions workflow running `server` tests (Linux, where embedded Postgres is
stable), client tests and build, and mobile jest on every PR. Make it required before merging.

### 9. No monitoring, alerting or error tracking
No Sentry or equivalent, no uptime monitor. Failed emails only appear in Render logs. If the API is
down at 7 AM, you learn it from a driver.
**Do:** an uptime check on `/health` with SMS or email alerts; error tracking on API and web;
alert on mail-send failures.

### 10. Admin account security
- No MFA for company or school admins, who can see every child.
- The web session token sits in `localStorage`, so any XSS means token theft.
- The login limit is per IP (20 per 15 min), so credential stuffing from many IPs isn't slowed.
- Tokens last 12 h and are only revoked by a password change.
- Inside one company, an admin can change a grandfathered co-admin's email and take the account
  over through "forgot password" (docs/tenant-isolation-audit.md).

**Do:** MFA (TOTP) for admin roles, a per-account lockout or backoff, fix the co-admin email
change, and consider httpOnly cookies for the web.

### 11. No audit trail of who saw or changed a child's record
Only password resets are logged. If a parent asks "who changed my child's address" or "who looked
at it", there is no answer.
**Do:** an append-only audit table for student and user writes (who, what, when), and reads of
student detail by staff and drivers if the DPA requires it.

### 12. There is no "remove a child" that works
- Deleting a student with any trip history is now a clear 409 (branch `fix-delete-500s`).
- A student with no trips is **hard-deleted along with their assignments, contacts and parent links**.
- There is no archive or deactivate for students or vans, and no process for a parent asking for
  their data to be exported or erased.

**Do:** an archive flag for students and vans (hidden from daily lists, history kept), plus a
documented data-request procedure.

## Can wait until after the first pilot weeks
13. **No staging environment.** Seed and cleanup scripts have been run against the live database
    (BACKLOG, "cleanup ran on production"). Test on a Neon branch, never on production.
14. **Hosting tier.** If the API is still on Render's free tier:
    - the first request after idle takes tens of seconds (drivers at 6:45 AM);
    - SMTP is blocked;
    - pre-deploy commands aren't available.
    Auto-deploy on push was recorded as broken. A $7 Starter instance removes most of this.
15. **Mobile distribution.** Drivers currently need Expo Go. Real use needs EAS builds (TestFlight or
    Play testing) and an update process.
16. **No way to link a company to an existing school.** The only path is creating a duplicate
    placeholder, which leads to duplicate school records. It now matters more, because students can
    only be added at linked schools.
17. **Two import systems with different rules** (per-page CSV and bulk import), and the other
    same-rule-twice drifts in docs/repo-health.md.
18. **Web vs mobile gaps**, e.g. school staff can't log "left early" on mobile (docs/web-mobile-parity.md).
19. **Operational plan.** Who answers the phone at 7 AM? What happens when a child isn't picked up?
    SafeTurns must not be positioned as the safety system of record. Write the incident procedure
    and the in-app disclaimer before the first real run.
20. **Single points of knowledge.** Approving claims, running migrations and restores are all
    manual steps only you know. Write the runbook (the claim steps are in the progress file).

## What is in good shape
- Tenant isolation holds on every normal route (tested for all six roles).
- Per-role access rules are covered by suite 17.
- Temporary passwords, forced change, resets and account lifecycle are tested on web and mobile.
- The import previews before writing and never deactivates anyone.
- Payroll rules are tested, including split shifts.
- A daily backup exists, once it's encrypted.
