# Live van tracking: design (not built)

Date: 2026-09-30. Status: proposal for decision. No code written.
Goal: admins and parents see where a van is on a map, from the driver's phone GPS.

## 1. How the driver app reports location
- **Only while the driver is checked in to a shift** (`sessions` open). Check-out stops tracking.
  No location is ever collected off-shift. This one rule removes most privacy risk for drivers.
- **API:** Expo `Location.startLocationUpdatesAsync` (background task). On Android it runs as a
  foreground service with a persistent notification ("SafeTurns is sharing your van's location
  during your shift"). Needs the background location permission on both platforms.
  **Background location does not work in Expo Go.** The app needs a development/production build
  (EAS), which changes how the team installs test builds today (the mobile README uses Expo Go).
- **Rate:** one fix every **10 s** or **25 m** moved, whichever comes first (`timeInterval`
  10000 on Android, `distanceInterval` 25). Fixes are sent in batches every **30 s**
  (`deferredUpdatesInterval`), 3 points per request. At a red light nothing is sent.
- **Accuracy:** `Balanced` normally; `High` only within ~300 m of the next stop, if we want
  arrival detection later.
- **Endpoint:** `POST /tracking/points` with `[{recorded_at, lat, lng, accuracy_m, speed, heading}]`.
  The server takes the session, company and van from the caller and the open session (never from
  the body), and drops points older than 24 h or outside the session's time window.

## 2. Battery
- Continuous GPS is the single biggest battery cost on a phone. Expect roughly **5–10% of a
  typical phone battery per hour** at High accuracy with the screen off, noticeably less at
  Balanced with a 25 m distance filter. These are planning estimates; the pilot must measure
  on the drivers' real phones.
- For a 4-hour tracked day (2 runs of 2 h) that is a real drain. **Recommendation: drivers keep
  the phone on a car charger during runs** (a $10 mount + cable per van is cheaper than support
  calls). Tracking stops at check-out.

## 3. No signal
- Fixes are **queued on the phone** (SQLite/AsyncStorage) with their own `recorded_at` and sent
  when the connection returns. Nothing is lost on a short tunnel or dead zone.
- The server accepts late points but only writes a point to "latest position" if it is newer than
  the stored one.
- The map shows **"Last seen 3 min ago"** once the newest point is older than 60 s, and parents see
  "Location updating…" instead of a frozen van that looks like it is moving.
- Airplane mode or a dead phone: the van stays at its last point with the "last seen" label.

## 4. Where positions are stored
- `van_positions` (append only): `session_id, company_id, van_id, driver_user_id, recorded_at,
  lat, lng, accuracy_m, speed, heading`. Index `(company_id, recorded_at)` and `(session_id, recorded_at)`.
  Partition by month if it grows (not needed below ~200 vans).
- `van_latest_position` (one row per van, upserted): what every map reads. Keeps map polling off
  the big table.
- **Which van?** Sessions don't record a van today; the van is inferred from the driver's
  assignments. A driver with two vans in one day is ambiguous (decision 6).

## 5. History retention
- Raw points: **30 days** (enough for "was the van late last Tuesday?" and incident review), then
  deleted by a nightly job. Optional: keep one summary row per session (start, end, distance)
  indefinitely for payroll disputes.
- The cost difference between 30 days and 1 year is small (see below); the real question is
  privacy and legal exposure (decision 3).

## 6. Cost at 10 / 50 / 200 vans
Assumptions: 22 school days a month; 2 runs × 2 h = 4 tracked hours per van per day; 1 point per
10 s, uploaded every 30 s; about 120 bytes per stored point including index; 10 students per van,
one parent each, each parent opens the map twice a day for about 10 minutes, map polled every 15 s.

| | 10 vans | 50 vans | 200 vans |
|---|---|---|---|
| Points per month | 316,800 | 1,584,000 | 6,336,000 |
| Upload requests/s during runs | 0.3 | 1.7 | 6.7 |
| Storage per 30 days kept | ~38 MB | ~190 MB | ~760 MB |
| Parent map polls per month | 176,000 | 880,000 | 3,520,000 |
| Peak map polls/s (30% of parents at once) | 2 | 10 | 40 |

**Neon** (Launch plan: $0.106 per CU-hour, $0.35 per GB-month storage, 500 GB egress included then $0.10/GB):
- Storage: 30-day retention costs **$0.01 / $0.07 / $0.27 a month**; a full year at 200 vans (~9 GB) about $3.20.
- Compute: if the database is already awake during school hours, tracking adds almost nothing.
  Worst case it keeps a compute awake 5 h × 22 days: 0.25 CU ≈ **$2.90/month** (10–50 vans),
  0.5 CU ≈ **$5.80/month** (200 vans).
- Egress: a few GB a month, inside the 500 GB included.

**Render** (web service: Starter $7/month 512 MB, Standard $25/month 2 GB; workspace bandwidth
Hobby 5 GB included then $0.15/GB, Pro workspace $25/month with 25 GB):
- 10 and 50 vans: the current instance handles it (well under 20 requests/s). **+$0.**
- 200 vans: ~40 polls/s at peak plus uploads. Move to **Standard, +$18/month** over Starter.
- Bandwidth: about 1 KB per poll → 0.2 / 0.9 / 3.5 GB a month. Inside Hobby's 5 GB, or ~$0 extra.

**Maps** (only map *loads* cost money; moving the marker between polls is free):
parents open the map about 44 times a month → 4,400 / 22,000 / 88,000 web map loads.

| Provider | 10 vans | 50 vans | 200 vans | Notes |
|---|---|---|---|---|
| Native maps in the mobile app (Google Maps SDK on Android, Apple Maps on iOS via react-native-maps) | $0 | $0 | $0 | Google's mobile Maps SDK is free and unlimited |
| Google Maps JavaScript (web) | $0 | $84 | $546 | 10,000 free loads/month, then $7.00 per 1,000 |
| Mapbox GL JS (web) | $0 | $0 | $190 | 50,000 free loads/month, then $5.00 per 1,000 |
| MapTiler Cloud (web) | $30 | $30 | $187 | Free tier is non-commercial; Flex $30 incl. 25k sessions, then $2.50 per 1,000 |

**Totals per month (added cost):**

| | 10 vans | 50 vans | 200 vans |
|---|---|---|---|
| Parents on the mobile app (native maps) | ~$3 | ~$3 | ~$24 |
| Parents on the web with Mapbox | ~$3 | ~$3 | ~$214 |
| Parents on the web with Google | ~$3 | ~$87 | ~$570 |

The map provider, and whether parents watch on the web or the app, is by far the biggest cost
driver. Everything else stays under $25 a month even at 200 vans.

## 7. Who sees which van, and when
| Role | Sees | When |
|---|---|---|
| company_admin | Every van of their company | While the van's driver is checked in |
| school_admin / school_staff | Vans carrying students of their school | Only during that van's run to or from their school |
| parent | Only the van assigned to their own child today | See below (decision 1) |
| driver, monitor | Their own van (the driver's own position) | During the shift |
| Anyone else | Nothing | Never. Same tenant rules as today (docs/tenant-isolation-audit.md) |

**Should a parent see the van only while their own child is on board?** The privacy problem:
before their child is picked up, the van is stopping at *other children's homes*. A live map
before pickup shows a parent where other families live. Options:
- **A. Only while on board** (between the pickup and drop-off trips logged for their child).
  Safest. But the most-wanted feature ("how far away is the van?") is missing in the morning.
- **B. Before pickup: ETA only** ("about 6 minutes away" or "2 stops before you"), no map. Map
  only once their child is on board. Recommended.
- **C. Map at all times during the run.** Most useful, and leaks other families' addresses.
  Not recommended.

## 8. Delivery to the screen
- Start with **polling `GET /tracking/vans` every 15 s** (reads `van_latest_position`). Simple,
  works through every proxy, costs little at these scales.
- Later, if needed: Server-Sent Events from the same endpoint (Render web services support
  long-lived connections) to cut polling traffic.

## 9. Also needed
- App store review: both stores require a clear justification for background location. The
  Android notification text and an in-app explanation screen are mandatory.
- Legal: drivers are told location is collected during shifts only (employee notice); the parent
  view is tied to children, so involve counsel on retention and consent before launch.
- Payroll and disputes can use `van_positions` later, but that is a separate decision.

## Decisions to make before anything is built
1. Parent visibility: **A** (on board only), **B** (ETA before pickup, map once on board) or **C** (map all run).
2. Where parents watch: mobile app only (free maps) or also the web (map provider cost).
3. Retention: raw points 7, 30 or 90 days; and whether to keep per-session summaries forever.
4. Map provider for the web: Google, Mapbox or MapTiler (and whether to pay for a routing/ETA API for option B).
5. Update rate: 10 s / 25 m as proposed, or slower (battery) or faster (smoother map).
6. How a position is tied to a van when a driver uses more than one van in a day (add `van_id` to check-in?).
7. School visibility: do school staff see vans at all, or only arrival status as today?
8. Car chargers for drivers: required, recommended, or company-provided.
9. Move the mobile app off Expo Go to EAS development builds (required for background location).
10. Legal review of employee location notice and parent data use, before the pilot.

Sources (fetched 2026-09-30): Neon pricing (neon.com/pricing), Render pricing (render.com/pricing),
Google Maps Platform pricing (developers.google.com/maps/billing-and-pricing/pricing),
Mapbox pricing (mapbox.com/pricing), MapTiler Cloud pricing (maptiler.com/cloud/pricing),
Expo Location docs (docs.expo.dev/versions/latest/sdk/location).
