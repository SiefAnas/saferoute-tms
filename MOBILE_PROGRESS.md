# Mobile app progress
Last updated: 2026-09-23 (session 2) | Branch: mobile-app | Last commit: see `git log -1`

## Status
The Expo app in `mobile/` is built and green: tsc, lint, jest (4 suites / 53 tests) and
expo-doctor were all clean at `e026d42`. Session 2 took over from a session that ran out of
tokens. Its working tree was clean (nothing uncommitted to rescue). Now working through:
end-to-end test on the live API, then polish, verify, and README.

## Done (with commit hashes)
- `8ac9cd1` Progress log started after reading `API_CONTRACT.md` and the server code.
- `4f7cedf` Expo SDK 57 app skeleton plus the driver and parent screens:
  - expo-router + TypeScript strict + TanStack Query + ESLint + Jest.
  - API client (`src/api/client.ts`): 45 s timeout for Render wake-up, `ApiError` vs
    `NetworkError`, 401 → session teardown.
  - Login, with the token in `expo-secure-store`. Session check on start with `/auth/me`.
    Logout and 401 clear the token and the whole query cache.
  - Role routing: driver → `(driver)` tabs, parent → `(parent)` tabs, admin roles →
    "use the website" screen.
  - **Driver** (design 3a):
    - Today: shift switch, status + progress, stop list, and a thumb bar with check in /
      next stop No-show + Picked up / Dropped off / check out. The switch-shift confirm uses
      `confirm_switch`, and "check out early" has a confirm.
    - Trips, Pay (month summary + days-worked calendar), Week (Coming soon).
    - Student sheet: route, notes, contacts with call buttons, school.
  - **Parent** (design 5b): child chips, status banner from real data, Today card, driver card
    with call, skip flow using `/skip-status` (split morning / whole day), Live ETA (Coming soon),
    Profile.
  - Shared Coming soon dialog + row (`src/components/Dialogs.tsx`).
  - Tests: api client, localDate, roles, stops.
- `e026d42` Bundle only the four Inter weights used; expo-doctor clean.

## In progress
- Step 2.1: end-to-end test on the live API with `Mobile Test ...` data.

## Next steps (in order)
1. E2E on the live API (driver: login, today, check in, pickup, check out; parent: login, child,
   skip). Fix app bugs found.
2. Polish: empty / loading / error + retry on every screen, touch targets, a11y labels,
   placeholder icon + splash.
3. Verify: tsc, lint, jest, expo-doctor, `expo export` ios + android.
4. `mobile/README.md` for Expo Go on Windows, EAS later, where to change name / bundle id / API URL.

## Decisions I made and why
- **Expo SDK 57** (latest stable): Expo Go in the app stores tracks the latest SDK, so it runs
  on a real phone with no build.
- **expo-router**, **expo-secure-store** for the token (contract: never AsyncStorage),
  **TanStack Query** (same query keys and invalidation as the web app).
- `src/lib/localDate.ts` ported from the web app; "today" for rules always comes from the server.
- Admin roles (company/school admin, school staff) are not in the mobile MVP: they get a
  "please use the website" screen instead of a half app.
- Session 2: the driver app must only use the driver's own data (server branch `access-scope`
  may narrow driver reads soon). The app reads students one by one from `/schedule/today`
  (`/students/:id`), never the company list. `/vans` (to find the driver's van) must fail soft
  (header without the van) if it gets restricted.

## API differences found (contract vs code)
The contract is accurate for everything the app needs. Small differences, none blocking:
- `POST /schedule/:assignmentId/no-show` returns `{ reported, noShow, notified }`; the contract
  only shows `{ reported: true }`. The app only reads `reported`.
- `GET /sessions` is ordered by `check_in_at` ascending, not newest first. The app sorts itself.
- "Already worked this shift today" uses the database's day (Neon is on GMT, see `PENDING.md`),
  so in the US evening the app's local-day view can disagree. The app never blocks on its own
  guess: it sends the request and shows the server's 409.
- Check-in GPS must be both numbers or neither (else 400). The app sends neither when location
  is denied or unavailable.

## Test accounts and test data created (no passwords)
- Session 1 was creating `Mobile Test ...` records on the live API with a script outside the
  repo when it stopped. Unknown what exists; checked in step 2.1 below.

## How to run it
See `mobile/README.md` (being rewritten in step 2.4). Short version: `cd mobile`,
`npm install`, `npx expo start`, scan the QR code with Expo Go.

## Known issues
- None confirmed yet in session 2.
