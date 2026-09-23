# Handoff: SafeRoute TMS visual refresh (Driver mobile + Company web)

## Overview
A visual modernization of the existing SafeRoute TMS React app (`client/`). There are no functional changes to the backend. It covers two directions the owner approved:
- **Driver app (mobile, `/driver`)**: design **3a**. Minimal light theme, plus a dark theme in slate + amber.
- **Company admin web (AdminLayout pages, starting with `/company/payroll`)**: design **3b**. Amber + slate, with light and dark themes.

## About the design files
`SafeRoute Directions.dc.html` is an **HTML design reference**, not production code. Recreate it inside the existing React 19 + Tailwind v4 + react-router + TanStack Query codebase. Use its patterns: `index.css` `@theme` tokens, `Button`, `Card`, `StatusBadge`, `Modal`, and the layouts. **Approved designs:** `3a` (driver app), `3b` (Payroll), `4a` (Company dashboard), `5a` (all other company and school admin pages), `5b` (parent app). Turns 2 and 1 at the bottom of the file are earlier explorations; ignore them.

## Fidelity
**High-fidelity.** Colors, type, spacing, radii and interactions are final. All data in the mock is fake. Wire everything to the existing endpoints: `/sessions`, `/trips`, `/schedule/today`, `/schedule/:id/no-show`, `/students/:id`, `/schools/:id`, `/payroll/*`.

---

## Global rules (apply everywhere)
1. **Buttons are sentence case. Never use all-caps.** Replace `'CHECK IN'`, `'PLEASE WAIT…'`, etc. Button size follows importance:
   - Mobile primary / thumb action: **52px** tall, radius 10, 15px/600
   - Web primary / secondary: **38px** tall, radius 9, 13px/600–700, padding 0 14px
   - Table row action: **32px**, radius 8, 12px/600
   - Compact / ghost: **32px**, radius 7, 13px/500
   - Change `Button.tsx` to take a `size` prop (`sm` 32 / `md` 38 / `lg` 52), replacing the hardcoded `h-14 text-title-lg`.
2. **One primary action per screen.** Use the amber fill (web and mobile dark mode) or the near-black fill (mobile light mode). Everything else is outline or ghost.
3. **Live status panels vs record tables look different.**
   - **Live panels** (hero "Owed this cycle", shift status): a slate fill (`#1e2632`) with amber figures, or an elevated card.
   - **Record tables**: a flat white card with a tinted header row and hairline row dividers.
4. **Elevation:**
   - Cards: `0 1px 2px rgba(25,28,30,.06), 0 4px 12px rgba(25,28,30,.04)`
   - Hero: `0 8px 24px -10px rgba(16,21,28,.5)`
   - Drawer: `-24px 0 60px -12px rgba(16,21,28,.4)`
   - Mobile bottom sheet: `0 -12px 40px rgba(16,24,40,.18)`
5. **Empty states always have** an icon tile (36–48px, radius 10–12, tinted), a one-line title, one explanatory line, and a next-step button where relevant. No plain grey text.
6. **Status color system.** Used everywhere as pills: 12px/600, padding 3px 10px, radius 12, with a 6px dot in the text color. Mobile pills are 11px/500, radius 5, and have no dot.

| Status | Meaning | Light bg / text | Dark bg / text |
|---|---|---|---|
| Live / success | Checked in, confirmed trip, paid | `#e0f5ea` / `#0b6b45` (mobile light: `#ecfdf3` / `#067647`) | `#123d2e` / `#6ee7b7` |
| Pending / caution | Awaiting school confirm, owed | `#ffddb8` / `#653e00` (mobile light: `#fffaeb` / `#b54708`) | `#3d2a0a` / `#ffb95f` |
| Alert | No-show, error | `#ffdad6` / `#93000a` (mobile light: `#fef3f2` / `#b42318`) | `#3f1716` / `#ff9b91` |
| Info | Parent skipped | `#dae2fd` / `#3f465c` (mobile light: `#eff8ff` / `#175cd3`) | `#1f2a4a` / `#a9b8f5` |
| Neutral | Not checked in, no rate set, ended | `#eceef0` / `#545f73` (mobile light: `#f2f4f7` / `#475467`) | `#273140` / `#aab4c3` |
| Up next | Next stop | mobile light: `#111318` / `#fff`; web / dark: `#f59e0b` / `#2a1700` | `#f59e0b` / `#2a1700` |

Replace `StatusBadge` tones with these five, plus `next`. Trip labels: "Awaiting school" becomes "Confirmed" (the auto-complete still happens server-side).

## Theming (light / dark)
- Implement with a `data-theme="dark"` attribute on `<html>` and CSS variables in `index.css`.
- Persist the choice in `localStorage` (`saferoute-theme`), and default to `prefers-color-scheme`.
- **Web toggle:** in the sidebar footer, next to the signed-in user's name, left of the logout icon. It's a 32×32 button, radius 8, bg `#323c4a`, with a Material Symbols `dark_mode` / `light_mode` icon, 18px.
- **Mobile toggle:** a 38px circular button, top-right of the greeting header (1px border, surface bg).

---

## Design tokens

### Mobile (3a)
| Token | Light | Dark |
|---|---|---|
| bg | `#fafafa` | `#141a22` |
| surface (cards, bars, sheets) | `#ffffff` | `#1e2632` |
| surface-2 (avatars, count chips) | `#f4f4f6` | `#273140` |
| border | `#e8e8ea` | `#2f3a48` |
| row divider | `#f0f0f2` | `#2a3441` |
| outline (secondary buttons) | `#e0e0e3` | `#3a4656` |
| text | `#111318` | `#eef1f5` |
| muted | `#6b6f76` | `#aab4c3` |
| faint | `#9aa0a6` | `#6f7b8c` |
| primary button bg / fg | `#111318` / `#ffffff` | `#f59e0b` / `#2a1700` |
| danger text (No-show) | `#b42318` | `#ff9b91` |
| segmented track / active | `#efeff1` / `#ffffff` + `0 1px 2px rgba(16,24,40,.12)` | `#0f141b` / `#273140` |
| progress fill / track | `#111318` / `#ececef` | `#f59e0b` / `#2f3a48` |
| tab active / inactive | `#111318` / `#8a8f98` | `#ffb95f` / `#6f7b8c` |
| note box bg / text / icon | `#fffaeb` / `#7a2e0e` / `#b54708` | `#3d2a0a` / `#ffd9a6` / `#ffb95f` |
| scrim | `rgba(17,19,24,.38)` | `rgba(0,0,0,.6)` |
| calendar worked / today | `#111318` on white / `#f59e0b` on `#111318` | `#f59e0b` on `#2a1700` / `#eef1f5` on `#141a22` |

### Web (3b)
| Token | Light | Dark |
|---|---|---|
| page bg | `#f2f4f6` | `#141a22` |
| sidebar | `#1e2632` | `#0f141b` |
| top bar | `#ffffff` | `#1a212b` |
| card / drawer | `#ffffff` | `#1e2632` |
| drawer header | `#1e2632` | `#0f141b` |
| border | `#e0e3e5` | `#2f3a48` |
| divider | `#eceef0` | `#2a3441` |
| table header bg | `#f7f9fb` | `#232c38` |
| text / sub / muted | `#191c1e` / `#3c475a` / `#545f73` | `#eef1f5` / `#d5dbe4` / `#aab4c3` |
| outline button bg / border | `#ffffff` / `#c9ced6` | `#1e2632` / `#3a4656` |
| avatar bg / fg | `#eceef0` / `#545f73` | `#273140` / `#d5dbe4` |
| hero card | `#1e2632` | `#273140` |
| selected row | `#fff8ef` | `#2a2418` |
| row hover | `rgba(245,158,11,.07)` | same |
| scrim | `rgba(16,21,28,.35)` | `rgba(0,0,0,.55)` |

**Amber is the same in both themes:** `#f59e0b` bg with `#2a1700` text. Hover `#f3a724`. Button inner highlight: `inset 0 1px 0 rgba(255,255,255,.35), 0 1px 3px rgba(133,83,0,.3)`. Hero figures use `#ffb95f`.

**Sidebar text:** item `#d5dbe4`, icon `#8b97a8`, group label `#6f7b8c`, active item amber fill with `#2a1700` text.

### Typography
- **Mobile:** Inter only.
  - Greeting 24/600, letter-spacing -0.02em
  - Section title 17/600
  - Row name 14/500, row meta 12/400
  - Button 15/600
  - Tab label 11/500
- **Web:** Public Sans for headings and numbers; Inter for everything else.
  - Page title 22/700
  - Card title 16/700
  - Hero figure 32/800, -0.02em, tabular numbers
  - Stat figure 28/700
  - Table body 14/500–700, table header 12/600
  - Sidebar group label 11/600, letter-spacing .06em, uppercase (the only uppercase allowed)
- Use `font-variant-numeric: tabular-nums` on all times and money.
- Icons: Material Symbols Outlined (already loaded). Mobile 20–22px, web 18–20px.

### Spacing and radii
- Keep the existing 8px scale (4/8/16/24/48).
- Mobile screen padding is 16–20px. Web content padding is 24px 28px, with gaps of 16–20px.
- Radii:
  - Mobile: cards 10, sheets 20 (top corners), buttons 10, pills 5
  - Web: cards 14, buttons 9, row buttons 8, pills 12

---

## Screens

### A. Driver app (mobile, 3a)
**Shell:** make a `DriverLayout` modeled on `ParentLayout`. It has no sidebar, a scroll area, and a fixed bottom tab bar.
- **Tabs, in this order:** **Today · Trips · Week · Pay**
- **Icons:** `route`, `receipt_long`, `calendar_view_week`, `payments`
- **Tab bar:** grid of 4, padding 8px 0 24px, surface bg, 1px top border. Active tab uses the "tab active" color, other tabs "tab inactive".

**Header (all tabs):**
- "Good morning, {first name}", which changes by time of day.
- Below it: "Tue, Sep 22 · **Van 04** · KX-4471". The van number is required; it comes from the van where `driver_user_id` is the current user.
- Dark-mode toggle at the right.

**Today tab**
1. **Shift switch:** segmented control, 2 columns, track radius 10, padding 3.
   - Buttons: "Morning" (`wb_twilight`) and "Afternoon" (`wb_sunny`), each with a count chip showing the number of students on that shift.
   - Selecting one filters the list with `itemsForShift()`. This is for viewing only; it does not check the driver in.
2. **Status row:** pill (Checked in / Not checked in / Shift ended / Other shift open) with "Since 6:48 AM" on the right. Below it, "{n} of {total} pickups handled" ("drop-offs" in the afternoon) and a 4px progress bar.
3. **Student list:** one card, with rows divided by hairlines.
   - Each row has a 26px number circle tinted by status (✓ when logged, ✕ for no-show), then the name (plus a `sticky_note_2` icon if the student has notes), then "address · grade" in the morning or "school · grade" in the afternoon.
   - Time and status pill sit on the right.
   - Skipped and absent rows are at 60% opacity.
   - **Tapping a row opens the Student sheet.**
   - Helper text below the list: "Tap a student for address, parents and notes."
4. **Thumb action bar:** fixed above the tab bar, with a surface background and a top border. It has four states:
   - Not checked in: primary "Check in to {morning|afternoon} shift" (`login` icon), plus the caption "Your location is saved with check-in".
     - If another shift is open, show the **Switch shifts** confirm sheet instead of checking in. It's a centered card 16px from the edges: title "Switch to {Afternoon}?", the existing copy, and Cancel / Switch shifts buttons. Confirming uses `confirm_switch: true`.
   - Checked in with stops left: the next stop's line ("Next pickup · 7:10 AM", name + `info` icon, address; tapping it opens the sheet). Below it, a 1fr / 2fr grid: **No-show** (outline, danger text; calls `POST /schedule/:id/no-show`) and **Picked up** / **Dropped off** (primary; calls `POST /trips`).
   - All handled: caption, then outline "Check out of {shift} shift".
   - Ended: "This shift has ended. View only."

**Student sheet** (bottom sheet, max-height 88%, internal scroll, 36×4 grabber):
- Header: 44px initials avatar, name 18/600, "Grade 3 · Age 8", 34px close button.
- **Route card:** "Morning pickup · 7:10 AM", then From → To with dot / line / square markers. Morning is Home → School; afternoon is School → Home. Home is `street_address · city, state zip`; school is `address`.
- If the parent skipped today, show an info-tone banner.
- **Note box**, if `notes` is set, in the note colors.
- **Parents & contacts:** the primary contact (`parent_name`, "Mother · Primary contact", `parent_phone`) with a 40px filled call button (`tel:` link). Then each `student_contacts` row (name, relationship, phone) with an outline call button.
- **School:** name, address, phone · hours (from `GET /schools/:id`).

**Trips tab:** "Today's trips · {n} trips" header, then one card listing the trips.
- Each row: time, name, "Pickup" / "Drop-off" / "No-show reported", status pill.
- Empty state: `receipt_long` icon tile, "No trips yet today", "Each pickup and drop-off you log lands here and waits for the school to confirm it.", and a "Go to today's students" button.

**Week tab:** "This week · Sep 21 – 25". One card per weekday (Mon–Fri), with a 1px border; today's card border uses the text color.
- Row: day + date, a "Today" pill or a ✓ for past days, "Morning 4 · Afternoon 5", and an expand chevron.
- Override notes appear as tinted strips: caution for time changes and early release, alert for skips.
- Expanding a day lists the Morning and Afternoon students with times. Changed times are shown in the caution text color. Tapping a student opens the sheet.
- **Backend gap:** only `/schedule/today` exists today. This needs `GET /schedule/week?from=` that returns the same shape for each day, with overrides applied.

**Pay tab:** "Pay · September".
- Card: "This month so far", $ amount at 32/600, "{days} days · {hours} h at {rate}".
- Card: "Days worked" 7-column calendar with 6px-radius cells. Worked days are filled; today is amber.
- Data comes from `/payroll/summary/:id` and sessions.

### B. Company web (3b), starting with Payroll
**AdminLayout sidebar** (240px, full height):
- Brand: 34px amber tile with the `local_shipping` icon, then "Dispatcher Hub" (15/700, white) and the company name (12px, `#8b97a8`).
- Nav rows are 38px, radius 9, 14px, with a 20px icon, grouped:
  - Dashboard (ungrouped)
  - **OPERATIONS:** Drivers (green "8 live" count pill), Fleet, Assignments
  - **PEOPLE:** Students, Parents
  - **FINANCE:** Payroll
  - Company Profile goes in the footer, or under a settings group.
- Footer (1px top border): 30px avatar, name + role, **theme toggle**, logout icon.
- Keep the existing collapse-to-rail behavior and the mobile drawer.

**Top bar:** 64px, top-bar bg, bottom border. Page title on the left. Actions on the right, in this order: ghost "CSV" (`upload_file`), outline "Add adjustment" (`add_card`), primary "Set pay rate" (`payments`).

**Payroll content:**
1. **Stat row:** grid 1.3fr / 1fr / 1fr, gap 16.
   - Hero "Owed this cycle": sum of unpaid `total_pay_cents`, plus "{n} drivers unpaid".
   - "Paid in September".
   - "Missing a pay rate" (count and names).
2. **Table card:** header "Drivers · current cycle" with the hint "Click a driver for the breakdown".
   - Columns: `2fr 1.2fr 1.2fr 1fr 1.1fr 110px`, i.e. Driver (32px avatar + name + van), Rate, Worked this cycle, Owed (right-aligned, 700), Status pill, Action.
   - Rows are 58px with hairline dividers.
   - Status: **Owed** (caution), **Paid {date}** (success), **No rate set** (neutral).
   - Action: outline "Mark paid" when money is owed; a caution-tinted "Set rate" when no rate is set.
   - Clicking a row opens the drawer.
3. **Breakdown drawer** (replaces `DriverCycleDetailModal`): right side, 420px, over the scrim.
   - Slate header: "CURRENT UNPAID CYCLE" in amber, name 22/700, "Since last paid {date} · {rate}", owed at 34/800 amber, worked total.
   - Body: "Shifts worked" (date / duration rows) and "Adjustments" (date · note / amount in success color). Each has the icon-tile empty state when there's nothing to show.
   - Footer: full-width primary "Mark {amount} as paid", or a success "Paid up" block.
4. **Toast** after marking paid: bottom-center, 10px radius, `check_circle` icon in `#6ee7b7`, "{name} marked paid · {amount}", auto-dismisses after about 2.6s.

Apply the same shell, table, stat card, drawer and empty-state patterns to Dashboard, Drivers, Fleet, Students, Parents and Assignments.

### C. Company dashboard (4a), `/company`
Replaces the placeholder CompanyAdminDashboard.
- **Top bar:** "Good morning, {name}" + date; Morning/Afternoon segmented control (switches every figure to that run); primary "New assignment".
- **Stat row** (1.4fr 1fr 1fr 1fr):
  - Slate hero: "{run} · trips done", figure in amber, % and a 6px progress bar.
  - Drivers on shift (open sessions / active drivers).
  - Waiting on schools (trips pending; caution color).
  - Absent today (pickup_skips + pickup_no_shows; alert color).
- **Left column:** "Live fleet" map card (placeholder; van pins from the last check-in GPS), then a flat "Absent today" table (student, school, reason pill: Parent skipped = info, No-show = alert).
- **Right column (340px):**
  - "Drivers" card with filter chips (All / On time / Late / Not in) and a scrolling list (avatar, name, van · stop x of y, status pill).
  - "Needs attention" list: no-shows, trips waiting on school, drivers not checked in, missing pay rates. Each has a tinted icon tile and a ✓ dismiss button; an "All clear" empty state shows when nothing is left.
- **Backend gaps:** a dashboard summary endpoint; driver lateness / stop progress needs route order, so show "On time / Not in" only until that exists.

### D. All other admin pages (5a): one shared records-page template
Use it for Company: Drivers, Fleet, Assignments, Students, Parents; School admin: Students, Pickup & drop-off (also the `/school-staff` page), Staff & access.
1. **Top bar:** page title; search field (260px, 38px, search icon, filters rows client-side); one amber primary action ("Add driver", "Add van", "New assignment", "Add student", "Add parent", "Add staff"; Pickup has none).
2. **Description line** (14px muted), then **3 stat cards** (value 28/700 in a tone color when it's a warning).
3. **Table card:** tinted header row, 58px rows, hairline dividers, first column = avatar + name + sub line, last column = status pill. Columns per page:
   - Drivers: Driver (email), Phone, Van, Pay rate, Status (Checked in / Not checked in / Deactivated)
   - Fleet: Van (brand · model · year), Plate, Color, Assigned driver, Status (On the road / Parked / No driver)
   - Company Students: Student (grade), School, Parent / guardian (+ phone), Driver · van, Status (Assigned / Skipped today / No-show today / Needs assignment)
   - Parents: Parent (email), Phone, Linked students, Status (Active / Not linked)
   - Assignments: Student, Driver · van, Shift, Usual times, Date range, Status (Active / override date / Unassigned)
   - School Students: Student (grade), Company · driver, Guardian (+ phone), Today (Picked up / Awaiting you / Skipped / No-show / Afternoon only)
   - Pickup & drop-off: Student, Trip (type · time), Driver (+ phone), Van, and an amber **Confirm** button (32px) that becomes a "Confirmed" pill. The "Waiting on you" stat counts the unconfirmed rows.
   - Staff & access: Staff (email), Role, Can see, Status (Active / No access)
4. **Row click opens the details drawer** (400px, right). Slate header: "DETAILS" in amber, name, sub line; key/value rows (130px label column); footer with Edit (outline) + Done. The existing create/edit modals move into this drawer pattern.
5. **Search empty state:** `search_off` icon tile, 'No matches for "{q}"', a hint line and "Clear search".
6. **Profile pages** (Company profile, School profile): a single 640px card with a 2-column form (40px fields, 12px/600 labels; name and street span both columns), plus Cancel + amber "Save changes".
7. **Sidebar:** built from a nav config per role, with group labels. Company: Dashboard · OPERATIONS Drivers, Fleet, Assignments · PEOPLE Students, Parents · FINANCE Payroll · SETTINGS Company profile. School admin: Students, Pickup & drop-off · PEOPLE Staff & access · SETTINGS School profile. The hub name ("Dispatcher Hub" / "School Hub") and org name show under the amber logo tile.

### E. Parent app (5b), `/parent`
Uses the mobile tokens and dark mode from 3a. Bottom tabs: Students (`group`), Profile (`account_circle`).
- Header: "Good morning, {name}" + date + dark-mode button.
- **Child chips** (36px pills; selected = primary fill) when the parent has more than one linked student.
- **Child card:** name 18/600, grade · school, a status banner (caution "Van 04 is 3 stops away"; info "Morning pickup skipped"; neutral "Afternoon ride only"), and a map placeholder while the morning ride is live.
- **"Today" card:** Morning pickup (time · home, or "No ride"), Arrives at school, Afternoon drop-off.
- **Driver card:** avatar, driver name, "Van 04 · White Ford Transit · KX-4471", 40px call button.
- **Thumb bar:** outline 52px "Skip today's pickup" with the caption "Available until the van leaves for your stop". Eligibility comes from `/parent/students/:id/skip-status`. It opens a confirm card ("Skip Ava's pickup today?", Keep pickup / Skip pickup) and then calls `POST /parent/students/:id/skip-pickup`. After skipping it shows "Skipped. Afternoon drop-off is unchanged." For a child with no morning ride it explains there's nothing to skip.
- **Profile tab:** read-only rows (name, email, phone, transport company) plus the note "To change your details, contact {company}."

## Suggested build order for Claude Code
1. Tokens + light/dark theme in `index.css`, the theme toggle, and `Button` sizes / `StatusBadge` tones.
2. The AdminLayout sidebar (groups, footer toggle) and the shared records-page template (table, stats, search, drawer, empty states).
3. The driver app (DriverLayout + Today / Trips / Week / Pay + student sheet).
4. Payroll, then the Dashboard, then the remaining admin pages, then the parent app.

## Interactions and state
- **Theme:** `theme: 'light' | 'dark'`, persisted.
- **Driver:**
  - `selectedShift` is independent of the open session.
  - `openStudentId` controls the sheet; `pendingSwitch` controls the confirm sheet; `expandedDay` controls the Week tab. The active tab is route or state.
  - After `POST /trips`, the row shows "Awaiting school" until the trip comes back `complete`. Keep the existing query invalidation.
- **Payroll:** `detailDriverId` controls the drawer. After mark-paid, invalidate `payroll-unpaid-summary` and `payroll-rules`, then show the toast.
- **Transitions:** background/color .25s on theme switch; progress bar width .3s; primary buttons scale to .98 on press.

## Assets
- No images. Icons are Material Symbols Outlined (already in `index.html`).
- Fonts: Inter + Public Sans (already loaded).
- Map areas from earlier turns are placeholders and not in scope.

## Files
- `SafeRoute Directions.dc.html`: open it in a browser. The final designs are `#3a` (driver) and `#3b` (web). Everything is clickable.
