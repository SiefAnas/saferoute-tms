SafeTurns: Bulk Import and Account Lifecycle Spec
Status: agreed design, not built yet Date: 2026-09-29 Target: build after the 3 Bees pilot is stable, October 2026 Suggested repo path: `docs/bulk-import-spec.md`
Lines marked DEFAULT are recommendations, not decisions. Change them freely.
1. Why this exists
A company with 100 drivers will not type them in one by one. They upload a file. The company must see exactly what will happen before anything is created.
2. Access model

* No self sign up. This is a B2B app.
* Only admins create accounts.
* Company admin: can import drivers, monitors, parents, vans, students for their own company.
* School admin: can import students and school staff for their own school only.
* School admin cannot import drivers or vans. Those belong to the company.
* All imports are scoped to the importer's own company or school. Never cross company.

3. Accounts and passwords

* Every user logs in with a real email address. Email is the login ID.
* Email is required and must be unique across the whole app.
* Drivers who do not have an email are expected to make one during onboarding.

Temp passwords

* The server generates a temp password for each imported account.
* Only the hash is stored. The plain password is never stored.
* The plain list is returned once, in the import result, as a table of name, email, temp password, with a Download button.
* After the admin leaves that page it is gone. There is no page anywhere that shows a temp password again.
* If the admin loses the list, they use Reset password on that single user. New temp password, shown once.

Forced change on first login

* New accounts are created with `must_change_password = true`.
* While that flag is true, every API route except change password returns an error.
* This is enforced on the server, not only in the web UI. Direct API calls and the mobile app hit the same wall.
* This is a login rule, not part of the import screen. A driver signing in on their phone is also forced to change the temp password before anything else works.
* Temp password expires after 7 days. DEFAULT. After that the admin resets it.

Password reset
Two paths, both stay:

1. Self service by email. Works for anyone with a working inbox.
2. Admin reset. Works for anyone, including bad or dead email addresses.

Rules for self service reset:

* Rate limit reset requests per email and per IP.
* Link expires in 1 hour, single use, dead after use. DEFAULT.
* The page never reveals whether an account exists. Always say "if that account exists, we sent a link".

Every reset, self service or admin, is logged: who, for whom, when.
Email health

* Flag on the user: `email_bounced`.
* When an email bounces, set the flag, stop sending to it, show a warning on the admin page.
* This protects the sending reputation so that parent notifications keep arriving.
* Account status shown to the admin: Created, Never logged in, Active.

4. Deactivation

* Terminate means deactivate (`is_active = false`), never delete.
* A deactivated user cannot log in and does not appear in assignment lists.
* They stay visible in past records: trips, check ins, no shows, payroll. That history is the product.
* Admins can deactivate drivers and monitors.
* Admins cannot delete parents.
* If the user has active assignments, block the action and say: "This driver has N active assignments. Reassign them before deactivating."

5. Import flow
One import screen, four steps. Web only.
The import feature is not shown anywhere in the mobile app. No menu item, no button, no hidden screen behind a role check. Admins import from the website.
Step 1: pick type
Dropdown: Drivers, Monitors, Parents, Vans, Students. The app does not guess what the file is. The admin says.
Step 2: upload and map

* Accepts .csv, .xlsx, .xls.
* The admin maps their column names to SafeTurns fields, for example their `Phone Number` to our `phone`.
* Remember the mapping per company so they only do it once. DEFAULT.

Step 3: preview

* A table of every row with a status: will create, will update, error with the reason.
* Counts at the top, for example 87 create, 6 update, 7 errors.
* Nothing is written to the database yet.

Step 4: confirm

* Good rows are imported. Bad rows are not.
* The result shows what happened, plus a downloadable error file.
* The error file contains the original rows exactly as uploaded, plus one extra column with the reason each failed. The admin fixes that file and re-uploads it directly.

6. Import rules
Create and update

* Matching keys: drivers, monitors and parents by email. Vans by license plate.
* Existing records are updated, not duplicated.
* Create and update counts are shown separately in the preview so the admin knows what they are agreeing to.

Never deactivate from a file

* If a file has 95 drivers and the company has 100, nothing happens to the 5 missing ones.
* Missing from a file means nothing. Deactivation is always a deliberate click.

Duplicates

* Two rows generating the same email is an error shown in the preview.
* Never silently rename, number, or merge them. Two people sharing one login destroys the record of who was responsible for a child on a given day.

Students

* A student can be created with no driver and no van assigned. This is allowed and normal.
* If the parent in a student row does not exist yet, create the parent from that row.

Import order
Companies and schools, then drivers and monitors, then parents, then vans, then students. The preview must catch missing dependencies and report them as row errors, not crash.
7. Limits

* Maximum 100 rows per file.
* Over the limit gives a clear message telling the admin to split the file, never a hang or a crash.
* A larger company splits into several uploads. This is intended, so that the preview stays reviewable.
* A file with no rows or no header row gives a clear error instead of running an empty import.

8. Data reading rules
These apply to both the parser and the import:

* Read every cell as text (`raw: false`).
* Read dates with `cellDates: true`.
* Otherwise Excel turns a phone number like 0781234567 into 781234567 and a date into a serial number like 45321.
* First sheet only.
* Trim header names, skip empty rows.

9. Not in scope for the pilot

* Automatic detection of what kind of file was uploaded. The admin picks the type.
* Multi file upload in one go.
* Rollback of a completed import.
* Self service password reset for drivers is available, but admin reset stays the main path until we see whether drivers read their inbox.
