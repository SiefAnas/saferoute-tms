# Design refresh report: branch `design-refresh`

Goal: make the client match the approved handoff in `design-reference/design_handoff_saferoute_refresh/`
(3a driver, 3b payroll, 4a dashboard, 5a admin pages, 5b parent) using real API data only.
Frontend only: nothing under `server/`, no migrations, no env vars, nothing on Render or Neon.

**Branch state:** 19 commits on top of `555a328`, all pushed to `origin/design-refresh`. Not
merged, nothing pushed to `main`. `git merge-tree` against today's `origin/main` (`55e5ee2`)
merges cleanly, since `main` only changed server files and docs tonight.

**Checks before every commit:** client `npm test` (payrollCycle 5/5, localDate 27/27), `tsc -b`
clean, `vite build` clean. The server test suite was **not** run, as instructed. Visual checks
used a throwaway fake API (in my scratch folder, not the repo) on port 5191 and the client on
port 5180. Light and dark mode, and desktop and phone sizes, were checked.

---

## At a glance

### Done
| Area | Design | Commit |
|---|---|---|
| Tokens, light/dark theme, base components | global | `c424012` |
| Admin shell: grouped sidebar, footer theme toggle, 64px top bar | 3b / 5a | `c8bdc95` |
| Payroll: hero, table, breakdown drawer, toast | 3b | `d4d68d7` |
| Driver app: Today / Trips / Week / Pay + student sheet | 3a | `ca291be` |
| Company dashboard | 4a | `45551fa` |
| Drivers, Fleet, Assignments, Students, Parents | 5a | `661e036` `d92967f` `73972b5` `9fe1724` `ba5eeb4` |
| Company + school profile pages | 5a | `81bef73` |
| School admin: Students, Staff & access | 5a | `4a43bd4` `32a9b9a` |
| Pickup & drop-off (school staff + admin) | 5a | `2d2d5b5` |
| Parent app | 5b | `46835dd` |
| Lazy-loaded pages (bundle 506 kB → 283 kB), sentence-case auth labels | — | `b7763d9` |
| Fix `max-w-sm` collapsing to 8px | — | `b0c8080` |

### Skipped or shown disabled (needs backend)
See "What the backend would need" below. In short:
- Payroll "Paid in {month}": shown disabled (no payment history is stored).
- Driver Week tab: only today has real overrides; other days show the usual schedule, with a
  banner saying so.
- Dashboard live map: placeholder card. Driver lateness / "stop x of y" by route order: shown
  as "On shift / Not in" and "x of y pickups".
- Parent "Van 04 is 3 stops away" banner and live map: not built.
- "Van 04" van numbers: vans have no fleet number, so the app shows brand, model and plate.
- Profile Email and City fields: no columns, so they're not shown.

### Overlaps with the other session (night 2 on `main`)
The other session **cancelled** its frontend items, and nothing of them is in git: sidebar
grouping (built, then reverted), empty states, card elevation, and the bottom check-in branch.
So there are **no code overlaps to reconcile**. For the record, this branch covers all four:
- Sidebar grouping → `AdminLayout` + nav config in `App.tsx`.
- Empty states → `EmptyState` / `InlineEmpty` / `NoMatches`, used on every page.
- Card elevation → `Card` + `--elev-*` tokens.
- Bottom check-in → the driver app's thumb bar (`ThumbBar` in `DriverTodayPage`).

`main` also changed `GET /schools` (it now includes the company's own school placeholders).
The Students page picker still calls it, so nothing to change here.

### Needs your decision
1. **Driver trip type is now fixed per shift.** The design has one action per stop: morning =
   "Picked up" (`trip_type: pickup`), afternoon = "Dropped off" (`dropoff`). The old per-row
   pickup/drop-off toggle is gone, so a driver can no longer log a morning drop-off or an
   afternoon pickup. School staff wording follows that: morning trip = "Arrived at school",
   afternoon trip = "Left with driver". Keep, or bring the toggle back?
2. **Driver "Check out early".** The design's thumb bar has no way to check out while stops are
   left. I added a large outline "Check out of {shift} shift early" button under the student
   list, kept large per the Check in/out rule. Keep it, or do you want it elsewhere?
3. **Driver and parent logout.** The design header has only the dark-mode button. I added a
   matching 38px logout button next to it. OK?
4. **Week tab with the usual schedule** (see backend section). OK as a stopgap, or hide the tab
   until `/schedule/week` exists?
5. **Dropped from the old dashboard** (not in 4a): the typeahead search across drivers, vans
   and students, and the "this week" payroll total card. Bring either back?
6. **Create/edit forms stay as centered modals.** The README says they "move into the drawer
   pattern". I kept the existing modals, restyled with labeled 40px fields, and open Edit from
   each row's drawer. Moving every form into the drawer body is doable, but it's a big change
   to tested form logic, so I left it for your call.
7. **Delete actions now ask first.** Deleting a van or an assignment used to happen on one
   click. Both now sit in the drawer behind a confirm step.

---

## What was built, by area

### Tokens and theme (`client/src/index.css`, single source of truth)
- The new roles: `bg`, `surface`, `surface-2`, `line`, `divider`, `outline`, `ink`, `ink-sub`,
  `muted`, `faint`, `action` / `on-action`, and status pairs `success` / `caution` / `alert` /
  `info` / `neutral` / `next` (`-bg` / `-fg`). Also sidebar, topbar, hero, drawer, mobile
  (`seg-*`, `tab-*`, `note-*`, `call-*`, `cal-*`), radii, and elevation.
- Dark mode: `[data-theme='dark']` on `<html>` overrides the same variables. `lib/theme.ts` plus
  an inline script in `index.html` (no flash) handle this: saved in `localStorage` as
  `saferoute-theme`, defaulting to `prefers-color-scheme`.
- Mobile palette: `.mobile-app` (on the driver/parent shells) re-points the shared roles. That's
  why the same `Button` is amber on web, near-black on mobile light, and amber on mobile dark.
- Shadows go through `--elev-*` variables, because Tailwind copies `--shadow-*` values into the
  utilities, so they can't be overridden per theme directly.
- The old Stitch token names still exist but now point at the new palette, so nothing breaks
  and everything follows dark mode.
- No hardcoded colors are left in pages. The only literal hexes live in `index.css`.

### Shared components
- `Button`: `sm` 32 / `md` 38 / `lg` 52; variants `primary` / `outline` / `ghost` / `danger` /
  `caution`. Sentence case everywhere. The old `secondary` (only used by modal submits) became
  `primary`.
- `StatusBadge`: the five tones plus `next`, with a `mobile` pill variant (11px, radius 5, no dot).
- `Card`, `Modal`, `Input` / `Select` / `Field` (40px, 12px/600 labels), `PasswordField`,
  `Drawer` / `DetailRows` / `DrawerSection`, `useToast`, `EmptyState` / `InlineEmpty` /
  `IconTile`, `ThemeToggle`.
- `Records.tsx`: the 5a template pieces (`StatCard`, `HeroStat`, `TableCard` / `TableRow` grid
  tables, `NameCell` / `Avatar`, `SearchField`, `NoMatches`, `Segmented`, `FilterChip`).
- `mobile.tsx`: `MobileShell` (header, scroll area, thumb-bar slot, bottom tabs), `ThumbBar`,
  `BottomSheet`, `ConfirmCard`, `CallButton`.
- `layouts/TopBar.tsx`: pages set the top bar's title and actions with `<PageTopBar>`
  (portaled into `AdminLayout`).
- `CsvImportExport` is now one ghost "CSV" button with an export/import menu.

### Admin shell (3b / 5a)
Slate sidebar with the amber hub tile, hub name, and the org's real name (`/companies/me` or
`/schools/me`). Grouped nav per role, and a green "{n} live" pill on Drivers (from open
sessions). Footer: avatar, name, role, theme toggle, logout. Collapse-to-rail and the phone
drawer are kept.

### Driver app (3a): `DriverLayout` + `/driver`, `/driver/trips`, `/driver/week`, `/driver/pay`
- **Header:** greeting by time of day, date, and today's van (from the driver's current
  assignment), plus the theme toggle and logout.
- **Today:** Morning/Afternoon switch with counts (view only). Status pill + since-time.
  Progress ("n of total pickups handled"). Numbered stops tinted by real state: Up next /
  Awaiting school / Confirmed / No-show / Parent skipped. Note icon; changed times in caution.
- **Thumb bar:** check in (GPS as before; the switch-shifts confirm card uses
  `confirm_switch`), next stop with No-show + Picked up/Dropped off, check out, view only once
  ended. Check in/out buttons are 52px.
- **Student sheet:** home↔school route by shift, parent-skip banner, notes, primary parent and
  `student_contacts` with `tel:` buttons, school from `GET /schools/:id`.
- **Trips:** today's trips plus reported no-shows. **Pay:** month-to-date from
  `/payroll/summary/:id` and a days-worked calendar.
- Replaces `DriverDashboard.tsx`. The student sheet drops the old "this month's trips"
  calendar, which isn't in the design (`MonthCalendar` was removed).

### Company pages
- **Payroll (3b):** hero "Owed this cycle" (sum of real unpaid summaries), missing-rate card.
  Table with Owed / Paid {date} / No rate set and Mark paid / Set rate. The 420px breakdown
  drawer replaces `DriverCycleDetailModal`. Toast after mark paid. Mark paid invalidates
  `payroll-unpaid-summary` + `payroll-rules`.
- **Dashboard (4a):** run switch; hero "trips done"; drivers on shift; waiting on schools;
  absent. Map placeholder. Absent table. Drivers list with filter chips. "Needs attention"
  (no-shows, waiting trips, not-checked-in drivers, shifts open over 10h, missing pay rates),
  with per-day dismiss and "All clear". "New assignment" opens the Assignments form.
- **Drivers, Fleet, Assignments, Students, Parents (5a):** search, CSV, one amber primary,
  description line, three stat cards, flat table, row → details drawer (Edit, Done, and
  delete where it existed, now behind a confirm).
  - Assignments: the drawer holds shift/time edit, one-off schedule changes, End today, and
    Delete. Unassigned students are rows with "Assign".
  - Parents: the access checklist (with the "Possible match" hint) moved into the drawer.
  - Students: the contacts panel moved into the drawer. Form logic is unchanged.
- **Company profile:** 640px two-column card, Cancel + Save changes.

### School pages
- **Students (5a school):** company + driver from the server-resolved `transport`, and a
  Today pill (Picked up / Awaiting you / Skipped / No-show / Afternoon only / Not yet).
- **Pickup & drop-off** (school admin and school staff):
  - "Waiting on you" stat, and a today's-trips table with an amber 32px Confirm that turns into
    a Confirmed pill.
  - Absent and schedule-changes cards.
  - Students table whose drawer has contacts, rides, that student's trips (confirm there too)
    and "Log change".
- **Staff & access:** stats, table, a drawer with the grant checklist, and Edit (school staff
  edit had no UI before).
- **School profile:** same card as the company profile.

### Parent app (5b)
- Mobile shell with Students / Profile tabs, and child chips when there's more than one child.
- Child card with a status banner from real data: skipped, dropped off, arrived at school,
  waiting on school confirm, afternoon ride only, next pickup time.
- "Today" card and a driver card with a call button.
- Thumb bar "Skip today's pickup" with a confirm card (Keep pickup / Skip pickup), using the
  server's eligibility. Split students choose morning or whole day.
- Read-only profile, with who to contact to change details.

### Kept on purpose
- Driver Check in/Check out and Login/Register submit stay large (52px).
- Dates: no `toISOString().slice(0, 10)` anywhere. All "today" logic uses `lib/localDate.ts`,
  and Postgres DATE values go through `calendarDateOf`. The one `toISOString()` left is a full
  timestamp sort key in the driver Trips tab.
- Existing query keys, so invalidation keeps working.

### Small fixes found along the way
- Assignments "active" used `new Date(end_date) >= new Date()` (off by a day west of UTC). It
  now compares calendar dates. Raw ISO dates on that page now show as "Sep 14".
- `--spacing-sm: 8px` (an existing token) also defines Tailwind's `max-w-sm`, so `max-w-sm`
  meant 8px. Nothing used it before tonight; I use `max-w-[24rem]` instead. Worth knowing:
  `max-w-xs/sm/md/lg/xl` are all hijacked by the spacing tokens in this project.
- Removed dead code: `DriverDashboard.tsx`, `MonthCalendar.tsx`, `InfoTooltip.tsx`.

---

## What the backend would need

| Feature (design) | What's missing | Suggested backend |
|---|---|---|
| Driver **Week** tab (3a) | Only `/schedule/today` exists; drivers can't read overrides for other days (`GET /assignments/:id/overrides` is admin-only) | `GET /schedule/week?from=YYYY-MM-DD` → same shape as `/schedule/today`, one entry per weekday, overrides + parent skips applied |
| "**Van 04**" in the driver header, parent card, fleet table | Vans have no fleet number | `vans.fleet_number` (text, nullable, unique per company) + in create/edit/list |
| Payroll "**Paid in {month}**" (3b) | Only `pay_rules.paid_through_at` is stored; the amount paid is lost on mark-paid | A `pay_payments` ledger (driver_id, amount_cents, paid_at, cycle_from, cycle_to) written by `POST /payroll/rules/:id/mark-paid`, plus `GET /payroll/payments?from&to` |
| Dashboard **summary** (4a) | Page adds up 9 list endpoints client-side | `GET /dashboard/summary?run=morning\|afternoon` (trips done/expected, drivers on shift, waiting, absent) |
| Dashboard **On time / Late**, "stop x of y" (4a) | No route order or planned stop times per driver | Route order per assignment (`stop_order`) + lateness rule; the UI already shows "x of y" from real trips |
| **Live fleet map** (4a) and parent map (5b) | No map provider; only check-in GPS is stored | Pick a map provider (key = env var, your call); optionally periodic location pings |
| Parent "**Van is 3 stops away**" (5b) | No live stop progress | Same as route order + current stop index, exposed on `/parent/students/:id/detail` |
| Parent no-show state (5b) | `/parent/students/:id/detail` doesn't say a driver reported a no-show | Add `no_show_today` (per shift) to that response |
| Profile **Email / City** (5a) | `companies` and `schools` have one `address` text, no email | `email`, `city` (and maybe split street) columns + PATCH `/companies/me`, `/schools/me` |
| Primary contact relationship ("Mother · Primary contact") | `students.parent_name` has no relationship | `students.parent_relationship` (nullable) |
| School "Arrives at school" time for parents | Only trip timestamps | Fine as is (uses the confirmed trip time); no change needed unless a planned time is wanted |

---

## How to look at it
```bash
git checkout design-refresh
cd client && npm install && npm run dev
```
Log in with the usual seed accounts, then switch theme from the sidebar footer (web) or the
moon button (phone).

Not committed and outside the repo: my fake API and a local preview server (Python) serving the
design reference. They were only for visual checks.
