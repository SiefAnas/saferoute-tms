# Overnight progress (2026-09-23 → 24)

Plan: Anas's overnight plan (4 jobs). Branches are a chain, each built on the previous one, so
they merge in order. **Nothing is on `main`; no Neon changes** (`assignment-weekdays` + 022 were
already merged and live before tonight).

## Merge order
1. `fix-phone-test` (from `main`), no migration
2. `stops-and-extra-addresses` (from 1), migration **023**
3. `monitor-role` (from 2), migration **024**
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

- **Job 3 `monitor-role`** (pushed, migration **024**)
  - New company role `monitor`: created by the company admin (`POST /users`, name + email,
    phone optional, temporary password, forced change). Assigned to one driver with weekdays +
    shift (`monitor_assignments`, `PUT/DELETE /monitors/:id/assignment`).
  - A monitor sees only: own check-in/out and hours, own pay, the driver's name + phone, the van
    (`GET /monitor/me`). Students / trips / vans / assignments / schedule / parent / dashboard /
    users all answer 403 (router-level deny, like parents).
  - Admin web: Monitors page (list, add, edit + reset password, assign to driver in the drawer),
    dashboard "Monitors" card (on shift / not in / off today), Payroll lists each monitor under
    their driver with their own rate, adjustments, mark paid, breakdown.
  - Monitor web (phone + desktop): Today (driver with call button, van, days + shift, check
    in/out with shift switch, today's hours) and Pay (same page as the driver's). Mobile: the
    same two tabs in a `(monitor)` group.
  - **Bug fixed on the way (affects drivers too):** `PUT /payroll/rules/:id` let a company admin
    overwrite another company's user's pay rate if they knew the id (the upsert's `ON CONFLICT`
    updated the other company's row). Now 400 "not found in your company". Covered in suite 23.
  - Tests: suite 23 (60 checks), monitor added to access matrix suite 17 (85 checks), mobile
    helper tests. Checked in the browser on a local DB: monitor Today (desktop + phone, check-in
    works), admin adds a monitor (temporary password shown), assigns them, dashboard card and
    payroll rows show them.

- **Job 4 `mobile-admin-roles`** (pushed, no migration, mobile only)
  - Step 1: company admin in the app. Tabs Today / People / Students / More.
    Today: drivers + monitors on shift (tap to call), drivers with runs today not checked in,
    absences. People: drivers / monitors / parents with search, details sheet (call, email),
    add driver or monitor (temporary password shown once, copy button), reset password.
    Students: search, school, parent (call), home address (tap to copy), rides with the driver
    (call). More: website links (assignments, fleet, payroll, monitors, parents, profile),
    appearance, log out. Every other action: "Open on the website".
  - Step 2: school admin / staff. Tabs Pickup / Students / More. Pickup: waiting on you (Confirm,
    call the driver), absent today, confirmed today. Students: search, parent (call), rides
    with company, van and driver (call). More: website links (admin: students + schedule
    changes, pickup page, staff and access, school profile; staff: their pickup page).
  - Checks: tsc, lint, 73 jest tests, and an Android bundle build (`expo export`). Not run on a
    real phone (no device here); see "What to test on the phone" in the final report.

## In progress
- Nothing. All four jobs are pushed.

## Next
- Anas: merge in order, run migrations 023 and 024 on Neon with their branches, test on the phone.

## Decisions
- Monitor daily pay: half the day rate per shift they checked in *and* out of. Drivers' daily
  pay depends on all their students being handled; a monitor has no students, and tying their
  pay to the driver's pickups would dock them for the driver's missed step. Simplest fair rule.
- One driver per monitor (saving replaces it). Several drivers per monitor is in V2_ROADMAP.
- Monitor hours never count toward the driver's pay; they are only *shown* under the driver.
- The monitor's van = the van on the assigned driver's current runs (today's first). No
  separate van field on the monitor, so it can't go stale.
- `notified` in no-show / skip / schedule-change responses now lists who is being told (the
  emails go out after the response), not who was already sent to.
