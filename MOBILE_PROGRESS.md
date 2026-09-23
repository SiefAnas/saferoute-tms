# Mobile app progress
Last updated: 2026-09-23 11:30 | Branch: mobile-app | Last commit: (this one)

## Status
Docs read, branch created and pushed. Starting Milestone 1 (Expo skeleton). No app code yet.

## Done
- Cloned `saferoute-tms` into `C:\Users\anas2\saferoute-mobile`, branch `mobile-app` created
  from `main` (`b7a890f`) and pushed to origin. Push works, no auth problem.
- Read `API_CONTRACT.md`, `V2_ROADMAP.md`, `PENDING.md`, `DESIGN_REPORT.md`
  (`design-reference/design_handoff_saferoute_refresh/README.md`), the web driver/parent
  screens (`client/src/pages/driver/*`, `client/src/pages/parent/ParentHomePage.tsx`),
  `client/src/lib/{api,localDate,format,geo,fleet}.ts`, `client/src/types/api.ts`, and the
  server code for the endpoints the app uses (`auth`, `sessions`, `schedule`, `trips`,
  `parentPortal`, `payroll`).

## In progress
- Milestone 1: Expo app skeleton in `mobile/`.

## Next steps (in order)
1. Milestone 1: Expo SDK 57 + TypeScript strict + expo-router + lint + Jest. API client,
   login, secure token storage, role routing, Coming soon component.
2. Milestone 2: driver app (Today / Trips / Week / Pay) - design 3a.
3. Milestone 3: parent app - design 5b.
4. Milestone 4: polish (empty/loading/error states, offline, touch targets, a11y, icon/splash).
5. Milestone 5: tests, tsc/lint/expo-doctor clean, `expo export` for ios + android,
   end-to-end run against the live API with `Mobile Test ...` accounts, `mobile/README.md`.

## Decisions I made and why
- **Expo SDK 57** (latest stable, `npm view expo dist-tags` -> `latest: 57.0.24`). Expo Go in
  the app stores tracks the latest SDK, so this is what runs on a real phone without a build.
- **expo-router** for navigation and **expo-secure-store** for the token (required by the
  contract: never AsyncStorage).
- **TanStack Query** for data fetching: the web app already uses it, so the query keys and
  invalidation logic in `client/src/pages/driver/driverData.ts` port over directly.
- Port `client/src/lib/localDate.ts` as-is; it is the one piece of date logic the contract
  calls out explicitly.

## API differences found (contract vs code)
Checked `server/src/routes` + `server/src/services` against `API_CONTRACT.md`. The contract is
accurate for everything the app needs. Small differences, none of them blocking:
- `POST /schedule/:assignmentId/no-show` really returns
  `{ reported: true, noShow: {...}, notified: [...] }`; the contract shows only
  `{ "reported": true }` (`server/src/services/schedule.js`). The app only reads `reported`.
- `GET /sessions` is ordered by `check_in_at` **ascending** (`orderBy: 'check_in_at'` in
  `services/sessions.js`), not newest-first. The app sorts what it needs itself.
- `POST /sessions/checkin`'s "already worked this shift today" check uses
  `check_in_at::date = CURRENT_DATE`, i.e. the **database's** day (Neon is on `GMT`, see
  `PENDING.md`), while the app can only see the phone's local day. So in the evening in the US
  the app may draw "Not checked in" for a shift the server considers already worked, or the
  other way round. The app never blocks on its own guess: it always sends the request and
  shows the server's 409 message. Same for no-shows and parent skips.
- `POST /sessions/checkin` GPS must be **both** numbers or **neither**, else `400 invalid GPS
  coordinates`. The app sends neither when location is denied/unavailable.

## Test accounts and test data created (Mobile Test ...)
None yet.

## How to run it
Not runnable yet. See `mobile/README.md` once Milestone 1 lands.

## Known issues
None yet.
