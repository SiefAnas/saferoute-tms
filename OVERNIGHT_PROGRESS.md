# Overnight progress (2026-09-23 → 24)

Plan: Anas's overnight plan (4 jobs). Branches are a chain, each built on the previous one, so
they merge in order. **Nothing is on `main`; no Neon changes** (`assignment-weekdays` + 022 were
already merged and live before tonight).

## Merge order
1. `fix-phone-test` (from `main`), no migration
2. `stops-and-extra-addresses` (from 1)
3. `monitor-role` (from 2)
4. `mobile-admin-roles` (from 3)

## Done
- (none pushed yet)

## In progress
- **Job 1 `fix-phone-test`**
  - 1.1 No-show: **cause found.** On the live API the no-show request did not answer within
    180 s (tested with the `@example.test` driver; the no-show *was* saved). The server waited for
    the notification emails, and SMTP on Render hangs (outgoing SMTP looks blocked). The app
    showed "Reporting…" until its 45 s timeout. Fix: emails go out after the response
    (`sendInBackground`), SMTP timeouts 10–20 s; no-show now asks to confirm, marks it, shows
    "… marked as no-show" and stays (web + mobile).

## Next
- 1.2 copy addresses, 1.3 theme switch (System/Light/Dark), 1.4 driver/parent desktop check.

## Decisions
- `notified` in no-show / skip / schedule-change responses now lists who is being told (the
  emails go out after the response), not who was already sent to.
