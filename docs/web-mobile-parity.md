# Web and mobile parity

Date: 2026-09-30. Code: `origin/main` at `71367cb`. Web = `client/` (React). Mobile = `mobile/` (Expo).
Method: every screen on both sides, and every API call each one makes. Report only, nothing changed.

**The shape of it:** drivers, monitors and parents get close to the same product on both. The
three admin roles get a deliberately smaller "run the day" app on mobile. Everything that edits or
configures points to the website ("On the website" links in the More tab). The admin gaps are
mostly by design; a few are real misses, marked **gap**.

## Across all roles
| Area | Web | Mobile | Note |
|---|---|---|---|
| Sign in, forgot password, reset link | Yes | Yes | Mobile takes the reset link or code pasted in (`extractResetToken`) |
| Forced password change on first login | Yes (`/set-password`) | Yes (`set-password`) | Same server rule; both route there on login and app start |
| Admin self sign-up, claim, verify email | Yes | **No** | By design: admins onboard on the website |
| Session ends (token expiry, deactivation) | Silently logs out to the login page | Logs out **with a message** ("Your session has ended…") | Different: web gives no reason |
| Expired temporary password | Server message shown at login | Same message at login; mid-session only "session ended" | See Task 5 |
| No connection | Generic "Check-in failed." style errors | "No connection" state with retry; slow-wake hint | Mobile is better |
| Server error (500) | Shows raw text "internal server error" | "SafeTurns had a problem. Please try again in a moment." | Different wording |
| Auto refresh | None (no polling, no refetch on focus) | None (pull to refresh) | Same |
| Import (bulk and per-page CSV) | Yes (admins) | No | By spec: web only |
| Theme (light, dark, auto) | Yes | Yes | |

## company_admin
**Web has, mobile does not**
- Dashboard with search, payroll snippet, live driver list (mobile has a smaller "Today" home, below).
- Drivers: edit, deactivate, per-page CSV. Monitors: assign to a driver, edit.
- Fleet (vans): list, add, edit, delete. **Mobile has no vans screen at all.**
- Assignments: create, edit, end, schedule overrides.
- Students: add, edit, delete, extra contacts, extra addresses, parent match suggestion, CSV.
- Parents: create, link and unlink to students (mobile shows parents but says "Add or link parents" on the website).
- Payroll: rates, adjustments, unpaid cycle, mark paid.
- Company profile. Bulk import page.
- Account status (Created / Never logged in / Active), temp-password expiry date and the
  bounced-email warning in the edit dialog. **Gap:** mobile shows only "Password: Temporary (not changed yet)".

**Mobile has, web does not**
- One-tap Call and Email on every person and student, and Call driver on a student's ride.
  (Both show who is on shift and who with runs today has not checked in.)

**Behaves differently**
- Adding people: mobile adds drivers and monitors (name, email, optional phone). Parents are
  website-only on mobile; that matches the server rule that a parent needs phone and address.
- Reset password: both; mobile shows the temporary password in a sheet with Copy, web in a dialog.

## school_admin
**Web has, mobile does not**
- Students page: grade filter, "Add a company" (placeholder), stat cards.
- Staff & access: create staff, grant and revoke which students each staff member sees.
- **Gap: "Left early" / "Staying later" schedule changes** (these cancel the company's pickup).
  Web only. On mobile a school admin at the gate cannot log one.
- School profile. Import (staff).

**Mobile has, web does not**
- Call buttons for parents and drivers.

**Behaves differently**
- Confirming arrivals: same API; mobile lists "Waiting on you" first with a Confirm button per trip.

## school_staff
**Web has, mobile does not**
- **Gap: schedule changes (left early / staying later)**, same as school_admin. This is a
  staff-at-the-door action, so it matters most here.
- School contact card (`/schools/me`).

**Mobile has, web does not**
- Call buttons.

**Same:** confirm trips, absent today, granted students only (server-enforced on both).

## driver
Near parity: Today (check in/out, shift switch with confirmation, log pickup/drop-off,
no-show, student sheet with school and extra address), Trips, Week, Pay on both.

**Behaves differently**
- After any check-in, check-out, trip or no-show, mobile reloads from the server whatever the
  outcome (`onSettled`), so a timeout that actually saved shows the saved state. Web reloads
  check-in, check-out and trips only on success (`onSuccess`), so after a timeout that did save,
  the web screen keeps showing the old state until the driver refreshes.
- Mobile says "No connection" and offers retry; web says "Check-in failed."
- Web lists all visible vans (`GET /vans`); mobile fetches only the van of the current assignment.
- Both send GPS with check-in and check-out when allowed, and never block on it.

## parent
Parity: children list, today's detail (driver, van, times, stops), skip pickup (morning or whole
day for split students), profile. Mobile adds Call buttons.

## monitor
Parity: today (driver name and phone, van, weekdays and shift), check in and out, pay. Mobile adds
the Call driver button. Neither shows any student data (server-enforced).

## Worth deciding
1. **Schedule changes on mobile for school staff and admins.** It's the one field action missing
   from the app of the role that performs it.
2. **Account status and bounce warning on mobile People** (Task 5 item 4 covers this).
3. **Web session-ended message.** Web drops to login without saying why; mobile explains.
4. **Web network error wording.** Adopt mobile's "No connection / Try again" handling.
5. **Vans on mobile** for company admins (read-only list at least), if dispatch happens away from a desk.
