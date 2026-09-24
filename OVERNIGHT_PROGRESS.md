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
- **Job 1 `fix-phone-test`** (pushed)
  - 1.1 No-show: **cause found.** On the live API the no-show request did not answer within
    180 s (tested with the `@example.test` driver; the no-show *was* saved). The server waited for
    the notification emails, and SMTP on Render hangs (outgoing SMTP looks blocked). The app
    showed "Reporting…" until its 45 s timeout. Fix: emails go out after the response
    (`sendInBackground`), SMTP timeouts 10–20 s; no-show now asks to confirm, marks it, shows
    "… marked as no-show" and stays (web + mobile).
  - 1.2 Addresses copy on tap / long-press, "Address copied" shown in place (in place, not a
    toast, because the mobile student sheet is a native modal that covers toasts). Driver student
    sheet + parent profile, web + mobile. Maps apps: V2 (small, ~half a day, see V2_ROADMAP).
  - 1.3 Theme: System / Light / Dark, saved. Web: the existing button (every role) cycles the
    three. Mobile: header button + "Appearance" in the parent profile.
  - 1.4 Checked the live site at 1280/1440: the desktop shell *is* live (no cache problem; the
    page's index.html revalidates). Rebuilt driver + parent desktop pages in the admin style:
    top-bar titles/actions, stat cards, record tables (Today run with row actions, Trips), Week
    grid, Pay stat cards + calendar card, parent child detail cards + inline skip card, profile
    detail card. Phone layout unchanged. Checked 390 / 820 / 1440.

- **Job 2 `stops-and-extra-addresses`** (pushed, migration **023**)
  - Server decides the route per run and day (`services/stops.js`): morning home → school,
    afternoon school → home; an extra address replaces home on its weekdays / dates / leg.
    Sent as `route` on `/schedule/today`, `/schedule/week` and the parent detail.
  - Admin: "Other addresses" on the student drawer (add / edit / remove). Parent: read-only list.
  - Driver web + mobile Today / Week and the student sheet show From → To; an extra address is
    highlighted (amber, alt-route icon, "Different address today: Grandparents").
  - Tests: suite 22 (37 checks), mobile route/weekday tests; checked in the browser on a local DB.
  - V2 in the roadmap: one-time address, time messages (half days), times per weekday.

## In progress
- **Job 3 `monitor-role`**

## Next
- Job 3 monitor role, Job 4 mobile admin roles.

## Decisions
- `notified` in no-show / skip / schedule-change responses now lists who is being told (the
  emails go out after the response), not who was already sent to.
