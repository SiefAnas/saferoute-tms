# Company timezone: open questions

Branch `company-timezone`. What I did in the meantime is written next to each.

## From the survey (bucket c)

1. **C1: whose "today" for a school user?** Schools have no timezone, and one school's students can
   ride with companies in different zones. I'm using **each record's company's** today: a school's
   absent / schedule-change lists show rows whose date is today for the company that owns them, and
   a school cancelling a student's pickup uses the student's company's today. The alternative is a
   `schools.timezone` column. Say if you want that instead.
2. **C2: an adjustment dated the day the cycle was marked paid.** Old or new cycle? Today the server
   counts it as still owed (it compares `work_date >= <date of paid_through_at>`), but that date came
   from the Node process's zone. The web client's comment in `payrollCycle.ts` says it was meant to
   be excluded. I'm keeping the server's current answer (still owed) and taking the date in the
   **company's** zone. Confirm which you want.
3. **C3: the clients choose "this week" / "this month"** from the viewer's own clock and send dates.
   The server reads those dates in the company's zone. Near midnight or month end a viewer in
   another zone asks for a different week / month than the company's. Not changed in this branch.

## Migration order at merge time

4. **032 before 030 / 031.** If this branch is deployed before `account-settings` /
   `prod-safety-and-import-fix`, Neon will have run 032 while 030 / 031 don't exist yet. When those
   land later, node-pg-migrate refuses to run a migration older than one already run ("Not run
   migration … is preceding already run migration …") unless it's run with `--no-check-order`.
   Options: merge 030 / 031 first, or run that one deploy with `--no-check-order`.
