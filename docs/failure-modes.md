# Failure modes

Date: 2026-09-30. Code: `origin/main` at `71367cb`. Report only.
For each situation: what the user sees **today** (read from the code), and what they **should** see.
Worst first. "Mobile" = the Expo app, "web" = the website.

## Facts the rest depends on
- **No offline queue anywhere.** Every action (check in, log pickup, no-show, skip, confirm) is
  one HTTP request; if it fails it is gone. Mutations are never retried automatically.
- **Nothing refreshes on its own.** No polling and no refetch on focus, on web or mobile. Screens
  update when the user acts, pulls to refresh, or reloads.
- **A trip can be logged twice.** `trips` has no uniqueness rule; each `POST /trips` inserts a new
  row and bumps the session's trip count. No-shows and parent skips *are* unique per student,
  day and shift (a repeat gets a clear 409).
- **Pending trips auto-complete** after `AUTO_COMPLETE_MINUTES` (5 by default) and email the
  company and school admins "not confirmed… please verify this actually happened".
- **Tokens last 12 hours, no refresh token.** Any 401 ends the session.
- Mobile tells "no connection" (`NetworkError`) apart from server errors, reloads after every
  action whatever the outcome, and says why a session ended. Web does none of these.

## 1. Driver phone offline during a route (airplane mode, dead zone, no data)
**Today (mobile):** check-in, pickups, drop-offs, no-shows and check-out all fail with "Could not
reach SafeTurns. Check your connection and try again." Nothing is saved on the phone.
Consequences the driver doesn't see:
- The school gets no pending trip to confirm, so there is no custody record for that child
  that day, not even an auto-completed one.
- **Daily-rate pay:** a shift only pays if every assigned student has a completed pickup and
  drop-off (or a no-show or skip). A route driven offline pays nothing for that shift.
- **Hourly pay:** if check-out fails, the session stays open until the driver checks out later,
  so hours are inflated.
- Parents' skip-status and "on the way" views don't move.

**Today (web):** same failures, with a generic "Check-in failed." / "Could not log the trip."

**Should:**
- Each action is saved on the phone with its own timestamp and a client-generated id, and sent
  when the connection returns.
- A banner shows "Offline: 3 actions saved on this phone, sending when you're back online".
- The server accepts late trips with the original time (within the shift), so custody, pay and
  hours are right.
- Check-out offline records the phone's time.

## 2. Network drops mid-action (request saved, response lost)
**Today (mobile):** the driver taps "Picked up", the server saves the trip, the answer never
arrives. The driver sees "Could not reach SafeTurns"; the automatic reload after the action may
also fail, so the row still looks not done. They tap again when the signal returns and a
**second trip** is created. Effects:
- The school confirms one; the other auto-completes and **emails admins a false "not confirmed"
  alert** about a child who was in fact handled.
- The session's trip count is wrong.

Check-in and no-show retries are safe but confusing: "you are already checked into Morning" /
"a no-show was already reported…".

**Today (web):** same duplicates; web also reloads only on success, so after a lost response the
screen keeps showing the old state until a manual refresh.

**Should:**
- Every write carries an idempotency key (client-generated id). The server treats a repeat as
  the same request and returns the original result.
- Plus a database rule: at most one trip per session, student and type.
- A retry after a lost response then shows "Picked up ✓", not an error.

## 3. Token expires mid-shift (12 hours after sign-in)
**Today (mobile):** the next request gets 401. The app clears the session and shows the login
screen with "Your session has ended. Please sign in again." The action being attempted is lost;
the driver has to type their password at the roadside. The shift stays open on the server, so
after signing in the screen is correct again.
**Today (web):** the same 401 silently drops to the login page with no explanation.
**Should:**
- A driver doesn't get signed out during an open shift: a refresh token or sliding session, or
  at least a warning 30 minutes before expiry, with one tap to renew while the shift is open.
- If it happens anyway, the failed action is kept and replayed after sign-in.
- Web gets mobile's message.

## 4. School pickup screen is stale
**Today (web and mobile):** the "Waiting on you" list only changes when staff refresh or confirm
something. A driver's new drop-off doesn't appear. If staff don't refresh within 5 minutes, it
auto-completes and **admins get the "not confirmed" email** even though staff were standing right there.
**Should:** the pickup screen refreshes every 15–30 s while open (or uses push), shows "Updated
10:42", and highlights new arrivals.

## 5. Two devices signed in as the same driver
**Today:**
- Both work; nothing stops or reports it.
- Check-in is serialized on the server, so the second phone gets "you are already checked into
  Morning". After a refresh both phones show the open shift.
- Checking out on phone A leaves phone B showing an open shift until refreshed; B's next pickup
  gets "check in for that shift before logging a trip".
- Both phones can log the same pickup: **duplicate trips** (see 2).
- Changing the password on one phone signs the other out.

**Should:**
- Trips are idempotent (see 2), so double logging is impossible.
- Either allow one active driver device and sign the other out ("You signed in on another
  phone"), or keep both and show "Also signed in on another phone".
- The other phone refreshes its shift state when it comes back to the foreground.

## 6. API returns 500 (or the server is waking up)
**Today (mobile):**
- A 500 shows "SafeTurns had a problem. Please try again in a moment." Mutations are not
  retried; queries retry twice with backoff.
- The first request after Render idles can take tens of seconds. Login shows a "waking up" hint
  after a delay; the timeout is 45 s.
- Because the app reloads after any outcome, a 500 on a write that actually committed still ends
  up showing the saved state.

**Today (web):**
- Shows the raw server text "internal server error" in the red action box.
- Queries retry once. No slow-wake hint.

**Should:**
- Both show a human message with a Retry button.
- Writes are idempotent so Retry is always safe.
- Web gets mobile's slow-wake hint and outcome-independent reload.

## 7. Account deactivated or password reset during a shift
**Today:** the next request answers 401 and the session ends:
- **Mobile:** "Your session has ended".
- **Web:** silent.
- **Nothing happens until the next request** (no background check), so an idle phone keeps
  showing the route.

An admin can't deactivate a driver or monitor who still has current or future assignments
(409), which limits this to people without upcoming runs. A reset (temporary password) also
ends every session.

**Should:**
- The app re-checks the session when it returns to the foreground.
- The message says what happened: "This account was deactivated. Contact your company." or
  "Your password was reset by your admin. Sign in with the temporary password."
  (Task 5 covers the mobile part.)

## 8. Parent actions on a bad connection
**Today:**
- A skip that saved but whose answer was lost: retrying gets "today's pickup was already
  skipped" (409). That's safe, but reads like an error.
- After the cutoff: "too late to skip today's pickup".
- Mobile shows "No connection" for network failures; web shows a generic error.

**Should:** a repeat of an identical skip answers success ("Pickup skipped ✓"), and the cutoff
time is shown before the parent taps.

## Summary: fixes in order of value
1. Idempotency keys on all writes, plus one trip per session, student and type (fixes 2 and 5,
   makes Retry safe everywhere).
2. Offline queue on the driver app for check-in, trips, no-show and check-out, with server
   acceptance of late, timestamped actions (fixes 1).
3. Auto-refresh on the school pickup screen (fixes 4, removes false "not confirmed" alerts).
4. No sign-out during an open shift (refresh or sliding session) and replay of the failed action (fixes 3).
5. Web error handling brought up to mobile's: no-connection state, session-ended message,
   reload after any outcome (fixes parts of 2, 3, 6, 7).
