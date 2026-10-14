# Render Cron Job: time-based pushes while the API sleeps

Everything time-based in SafeTurns is checked by the API itself while it runs:

| What | Code | API checks every |
|---|---|---|
| Driver sign-in reminders (N minutes before the first stop) | `server/src/services/signinReminders.js` | 1 minute |
| Scheduled notifications and retries (e.g. "monitor not picked up after 4 minutes") | `server/src/services/push.js` | 30 seconds |
| Van maintenance + odometer reminders (07:00–20:00 company time) | `server/src/services/fleet.js` | 15 minutes |

On Render's free tier the API **goes to sleep after about 15 minutes without traffic**, and nothing
runs while it sleeps. A 6:30 am sign-in reminder is exactly when nobody is using the app, so without
a cron job it would arrive late (whenever someone wakes the API) or after the run has started (then
it is skipped on purpose).

The cron job runs `server/scripts/send-due-notifications.js` on a schedule: one pass of all of the
above, then it exits. It is safe next to the API: every send is claimed in the database first, so
nothing is ever sent twice.

## Set it up (about 5 minutes)

1. **Deploy the API first** (with this branch merged), so the database has migration 038. The cron
   job does not run migrations.
2. Render Dashboard → **New** → **Cron Job**.
3. **Source:** the same GitHub repo (`SiefAnas/saferoute-tms`), branch `main`.
4. Settings:
   - **Name:** `safeturns-cron` (anything)
   - **Region:** the same region as the API and the database
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm ci`
   - **Command:** `npm run notifications:send-due`
   - **Schedule:** `*/5 * * * *` (every 5 minutes). Render schedules are in **UTC**; every-N-minutes
     doesn't care. For reminders to the minute use `* * * * *` (costs more run time).
5. **Environment variables.** The same values as the API service. The easiest way: if the API uses
   an Environment Group, link that group. Otherwise copy these from the API service's Environment tab:

   | Key | Value | Why |
   |---|---|---|
   | `DATABASE_URL` | same as the API | the database |
   | `ALLOW_PRODUCTION_DB` | `yes` | the safety guard refuses a remote database without it |
   | `NODE_ENV` | `production` | |
   | `JWT_SECRET` | same as the API | the config refuses to start in production without it |
   | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | same as the API | browser pushes |
   | `EXPO_ACCESS_TOKEN` | same as the API, only if you set one | phone pushes |
   | `NODE_VERSION` | same as the API, if you set one there | |

6. **Create Cron Job**, then press **Trigger Run** once. The log should end with a line like
   `[cron] 2026-10-15T10:30:00.000Z sign-in reminders 0, due notifications 0, receipts checked 0, fleet reminders 0`
   and the run should show as succeeded. An error about `ALLOW_PRODUCTION_DB` or `JWT_SECRET` means
   a variable from step 5 is missing.

## Good to know

- **Cost:** cron jobs are a paid Render service, billed by how long each run takes (a run here is a
  few seconds). Render shows the price on the create page; check it there.
- **Timing:** with every 5 minutes, a "30 minutes before" reminder arrives 25–30 minutes before the
  first stop. A reminder is never sent after the first stop time.
- **The API still does it too** while awake; whichever gets there first sends, the other skips.
- **To stop it:** the cron job's Settings → **Suspend Cron Job**. To stop only the sign-in
  reminders, turn them off on the website (Drivers → Sign-in reminder → Off).
- If the API moves to a paid instance that never sleeps, the cron job is no longer needed (it does no
  harm if you keep it).
