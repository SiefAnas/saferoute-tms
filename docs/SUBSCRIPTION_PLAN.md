# Subscription plan (branch `subscription-plan`)

Plan only. No code, no migration, nothing merged. Revision 2: these decisions replace revision 1
where the two disagree. The questions still open are at the end.

## 0. Ground rules

- SafeTurns is billed **monthly, per active van, up front on the 1st** (company timezone), paid on
  **safeturns.com** (the web client) through **Stripe Billing**.
- **Nothing can be bought in the mobile app.** No price, no payment link, no "upgrade" anywhere in
  mobile.
- **Any `company_admin`** of the company can manage billing. Nobody else.
- **Test mode only** while building. The server refuses to start with a `sk_live_` key unless
  `BILLING_LIVE_MODE=on` is also set, and only the owner sets that, by hand, on Render.

### Privacy rules (the repo is shared with an outside reviewer)

- The **real price never appears** in code, docs, tests, commits or PR text. It lives only in Stripe.
  Code reads the Price ID from `STRIPE_PRICE_ID` and asks Stripe for the amount at runtime
  (cached in memory). The amount is never stored in our database as configuration.
- `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` live only in Render env vars. `.env.example` gets
  empty placeholders.
- No real customer names in code, tests or docs. Per-company dates live in the database
  (`free_until`). There is never an `if company is X`.
- Examples and tests use a **fake price of $31/van** (in a 31-day month, 1 day = $1).

| env var | what |
|---|---|
| `STRIPE_SECRET_KEY` | test key while building |
| `STRIPE_WEBHOOK_SECRET` | signing secret of the webhook endpoint |
| `STRIPE_PRICE_ID` | the per-van monthly Price |
| `BILLING_FREE_CUTOFF` | date (`YYYY-MM-DD`); the owner sets it (section 6) |
| `BILLING_LIVE_MODE` | must be `on` before a `sk_live_` key is accepted |

## 1. What exists today

- **Billing page** (`client/src/pages/company/BillingPage.tsx`): read only, company_admin only. It
  shows the hard-coded pilot label and five usage counts.
- **API**: `GET /companies/me/billing` and `GET /companies/me/usage` (`requireRole('company_admin')`).
- **DB**: `companies.billing_plan` (only `'pilot'`) and `companies.billing_status` (only `'free'`
  or `'closing'`), `trial_ends_at` (unused), `usage_snapshots` (daily counts; the script exists but
  is not scheduled).
- **Vans have no active flag** and are hard-deleted.
- **Closure** writes `billing_status = 'closing'`, and undo writes back `'free'`.
- **Runs** are `sessions` rows: `check_out_at IS NULL` = in progress. A forgotten check-out stays
  open forever (see Q2).
- **Sweeps**: the API runs `setInterval` sweeps for pushes, sign-in reminders and fleet reminders,
  and `scripts/send-due-notifications.js` runs the same work from a Render cron job while the API
  sleeps. Billing uses the same pattern.
- **Parents and school staff**: emails are unique across all users, and a parent account belongs to
  exactly one company. School staff belong to a school and see students from several companies
  through `staff_student_access`.

## 2. Database

### `subscriptions`: exactly one per company

| column | notes |
|---|---|
| `id`, `company_id` (unique, FK ON DELETE RESTRICT) | billing history never vanishes in a cascade |
| `stripe_customer_id`, `stripe_subscription_id` | unique, null until the first Checkout |
| `stripe_status` | last status Stripe reported (`trialing`, `active`, `past_due`, `canceled`...). For display and debugging only; access is computed (section 5) |
| `free_until` | date, company-local, **last free day, inclusive** (section 6) |
| `payment_method_added_at` | timestamptz; null = no payment info on file |
| `overdue_since` | timestamptz; when Stripe reported the failure (the Stripe event's `created` time, not when we received it), or the day after `free_until` with no payment info. Null = not overdue |
| `overdue_invoice_id` | the bill that must be paid to unlock |
| `ach_processing_since` | an ACH payment for the overdue bill is processing (counts as paid until it fails) |
| `locked_at` | the first time the lock actually took effect (written lazily, section 5) |
| `cancel_at_period_end`, `canceled_at` | |
| `created_at`, `updated_at` | |

### `billing_periods`: one row per company per month

`subscription_id`, `month` (date, the 1st), `van_count`, `van_ids uuid[]` (which vans were counted),
`stripe_invoice_id` (unique), `amount_cents`, `invoice_status`, `hosted_invoice_url`. Unique
(`subscription_id`, `month`). The Billing page lists these and links to Stripe's hosted invoice.

### `van_billing_events`: the proration ledger

| column | notes |
|---|---|
| `company_id`, `van_id` | `van_id` has no FK: rows outlive a deleted van |
| `van_label` | plate / number at the time (not personal data) |
| `kind` | `added`, `retired`, `unlocked` |
| `local_date` | the company-local day it happened |
| `days`, `amount_cents` | computed with the formula in section 3 |
| `stripe_invoice_item_id` | unique; the pending item it became |

Unique (`van_id`, `kind`, `local_date`), so a retried request or job can't charge twice.

### `billing_events`: webhook log

`stripe_event_id` (unique), `type`, `payload jsonb`, `received_at`, `processed_at`, `error`.

### Changes to existing tables

- `vans.retired_at timestamptz` (null = active). **Deleting a van retires it that day first**: the
  `retired` ledger row is written in the same transaction as the delete.
- **Closure stops touching billing.** It already has `closure_requested_at`. Access treats "closing"
  as its own condition, so undo only clears the closure fields and the billing state is exactly
  what it was before (decision 9). `companies.billing_plan` / `billing_status` / `trial_ends_at` are
  dropped once nothing reads them.
- `usage_snapshots.active_vans` next to `vans`.

## 3. Price and proration

**Monthly bill (up front).** On the 1st, the bill charges `active vans at 00:00 company time on the
1st × price`. Stripe's renewal runs with subscription quantity = that count.

**Per-day proration (decision 3).**
`amount = round(price_cents × days ÷ days_in_that_month)`. **One rounding per line, to the cent.**
The daily rate is never rounded on its own.

| event on day *d* | days | at the $31 test price, 31-day month |
|---|---|---|
| van **added** | `days_in_month − d + 1` (the add day counts as used) | added day 13 → 19 days → **+$19.00** |
| van **retired / deleted** | `days_in_month − d` (the retire day counts as used) | retired day 27 → days 28-31 → **−$4.00** |

Both lines become **pending Stripe invoice items** on the customer. Stripe pulls pending items into
the next subscription invoice automatically, so they land **on the next 1st's bill**, never as a
separate charge. A negative total is left as customer credit balance (no cash refund; the owner
refunds by hand if ever).

A van added and retired in the same month is consistent: +19 for day 13, −4 for day 27 = 15 days
(days 13-27). A van on the 1st's bill and retired on the 1st costs 31 − 30 = 1 day.

### Stripe proration or our own invoice items? **Our own invoice items.**

Stripe's built-in proration works out the fraction of the period **in seconds**. Changing that to
whole days needs Stripe's proration customization feature, not a parameter. `proration_date` only
moves the start point; it is still seconds-based. A company-time day-boundary
`proration_date` matches our formula in most months but **not in a month with a DST change**,
because that month is 743 or 745 hours long, not 31 × 24. I checked both examples with a script (the
$31 test price, a New York company, Stripe's seconds-based ratio over company-local midnights):

| month | added day 13: ours / Stripe-style | retired day 27 credit: ours / Stripe-style |
|---|---|---|
| January 2027 (no DST change) | $19.00 / $19.00 | $4.00 / $4.00 |
| March 2027 (DST starts the 14th) | $19.00 / **$18.98** | $4.00 / **$4.01** |

Stripe's renewal time is also fixed in UTC, so the period boundary drifts an hour away from local
midnight in summer. So: the subscription runs with `proration_behavior: 'none'`, and we create
the proration lines ourselves from the ledger. The formula is one pure function that tests cover
directly.

**Tests to write:** (unit, pure function) both examples in January **and** March: +$19.00 and
−$4.00 in each, plus 28/29/30-day months, add-and-retire in the same month, retire on the 1st.
(Integration, Stripe **test mode + test clocks**, skipped unless a `sk_test_` key is set) add on day
13 → the pending item is +$19.00 and appears on the next 1st's invoice; retire on day 27 → −$4.00
on that same invoice.

**Note:** those numbers are my arithmetic, not a run against Stripe. No Stripe test account was
available here, so the test-clock tests are part of the build.

### Getting the 1st right

- Subscription anchor: the 1st at 02:00 company time (in standard time). That is after local
  midnight all year, and the 1st is never a DST-change day in the US.
- An hourly billing job (API sweep + Render cron) sets the subscription quantity to the count
  **as of 00:00 company time on the 1st**, computed from `vans.created_at` / `retired_at`. It is
  computed from timestamps, so a late run still gets the right number.
- Safety net: on `invoice.created` (draft, `billing_reason = subscription_cycle`), the webhook
  compares the invoice quantity with our count. If they differ, it adds a correcting invoice item
  before Stripe finalizes the draft (about an hour later). It writes the `billing_periods` row.

## 4. Payment methods and Stripe flows

- **Stripe Checkout** (hosted) to add payment info and start the subscription. **ACH
  (`us_bank_account`) listed first, card allowed.** In hosted Checkout, Apple Pay and Google Pay
  come with card at no extra code, so they are on. Nothing more is built for them.
- **Stripe Customer Portal** to change the payment method and see invoices.
- Routes, all behind `requireRole('company_admin')`:
  `GET /companies/me/billing`, `POST /companies/me/billing/checkout`, `POST /companies/me/billing/portal`,
  `POST /companies/me/billing/cancel`, `POST /companies/me/billing/resume`. Return URLs are fixed to
  `https://safeturns.com/company/billing` (config, never from the request).
- **Cancel (decision 4):** sets `cancel_at_period_end`. The company keeps access to the end of the
  paid month, then it is locked (section 5, "canceled"). No data deleted; deletion only through the
  existing closing flow. A canceled company's admin can restart from the Billing page.

### Webhook `POST /billing/webhook`

Mounted before `express.json()` (raw body), no session auth, own rate limiter.

1. Verify the signature (`STRIPE_WEBHOOK_SECRET`); a bad one → `400`.
2. `INSERT INTO billing_events ... ON CONFLICT (stripe_event_id) DO NOTHING`; already processed → `200`.
3. Events arrive late and out of order, so handlers **re-fetch the subscription or invoice from
   Stripe** and write the current truth.
4. One transaction, `processed_at` set, `200`. Any error → `500`, stored, and Stripe retries.

| event | effect |
|---|---|
| `checkout.session.completed` | link customer/subscription, set `payment_method_added_at`; post-cutoff company: start the free month (section 6) |
| `invoice.created` (subscription_cycle) | quantity safety net, `billing_periods` row |
| `invoice.finalized` | invoice id, amount, hosted URL on the period |
| `invoice.payment_failed` | if not overdue: `overdue_since = event.created`, `overdue_invoice_id`. If it is the overdue bill's ACH that was processing: clear `ach_processing_since`; **the original clock stands, no new grace** |
| `payment_intent.processing` (ACH, for the overdue bill) | `ach_processing_since` → **unlocked right away** |
| `invoice.paid` (the overdue bill) | clear `overdue_*`, `ach_processing_since`, `locked_at` → unlocked; unlock proration (section 5) |
| `customer.subscription.updated` / `.deleted` | sync `stripe_status`, `cancel_at_period_end`, `canceled_at` |

## 5. Access: failed payment, lock, cancel

### Computed from stored timestamps on every request

One pure function, `billingAccess(subscription, company, now, hasOpenRun)`, is called from
`requireOperable` (one extra joined query when auth loads). It returns the company's state and what
each role may do. **No step depends on a timer having run.** If the API slept through day 5, the
first request on day 6 is already read-only. The sweep (API interval + Render cron) only does the
side effects that must happen once (emails, Stripe `pause_collection`, writing `locked_at`), and is
idempotent.

Day 1 = the company-local date of `overdue_since`.

| state | when | company_admin | everyone else |
|---|---|---|---|
| `ok` | free, paid, or ACH processing | full | full |
| `overdue` | days 1-4 | full + banner, email | full, no banner |
| `admin_read_only` | days 5-8 | **read-only except Billing** + banner | full |
| `lock_pending` | lock time reached, a run still open | as above | runs in progress continue; **no new check-in** |
| `locked` | lock time reached, no run open (or `locked_at` already set) | **sign-in → Billing page only** | paused |
| `needs_payment_info` | post-cutoff company, no payment info yet | Billing page only (start free month) | paused |
| `canceled` | after the paid month of a canceled subscription | Billing page only (restart) | paused |

- **Lock time:** 22:00 company time on day 8 (Q1). From then the company locks at the first moment
  no `sessions` row of the company is open. **Never while a run is in progress.**
- **Paused**, for everyone else on web and for everyone on mobile (company admins too): "This account
  is paused. Contact your transportation company." **Never the word "unpaid"**, no price, no
  payment link. The API returns `403 { error: 'account_paused' }` with nothing else.
- **Admin read-only** = every write method is refused except billing routes, sign-out and own
  password.
- **Scheduled pushes and reminders stop** for a locked, `needs_payment_info` or canceled company:
  the push, sign-in-reminder and fleet sweeps skip it.
- **School staff** keep access to students of other companies. Rows that belong to a paused
  company are filtered out of their lists. **Parents**: an account belongs to one company, so a
  parent of a paying company is never affected by another company's lock.
- **Unlock**: paying the overdue bill, or an ACH payment for it starting to process, unlocks right
  away. If that ACH then fails, the original clock stands: past lock time, the company locks again
  (still never mid-run).
- **No bills for locked time.** On lock, the sweep sets Stripe `pause_collection: { behavior: 'void' }`,
  so any 1st's invoice created while locked is voided. On unlock: collection resumes, the month of
  the overdue bill gets a credit for the locked days (from the day after the lock day to the day
  before the unlock day; both of those days count as used, like vans), and the current month gets a
  charge from the unlock day to month end (`unlocked` ledger rows). Both go on the next 1st's bill.
  **To unlock they pay the failed bill**, nothing else.
- **Emails to company admins:** day 1 (payment failed), day 5 (read-only started), day 8 (locks
  tonight after runs end), on lock, on unlock. Never sent to other roles.

## 6. Free periods

`subscriptions.free_until` (company-local date, the last free day, inclusive). Per company, in the
database.

- **Joined before the cutoff** (company created before `BILLING_FREE_CUTOFF`): `free_until` = the day
  before the cutoff, written at migration (existing companies) and at signup. **No trial.** Billing
  starts on the cutoff date: an up-front charge for the active vans for the days left until the 1st
  (same per-day formula), then full months on the 1st.
- **Pilot extensions:** `node scripts/set-free-until.js <company-id> <YYYY-MM-DD> [--dry-run]`.
  It takes only an id and a date, prints old → new for that id, and contains no names. The same
  script with the cutoff date moves an existing company if the cutoff changes.
- **Joined after the cutoff:** state `needs_payment_info` until a company_admin completes Checkout.
  That day starts **one free month** (`free_until` = same date next month − 1 day; Q4). After it:
  prorated days until the 1st up front, then full months.
- **Reminders:** if no payment info is on file, company admins get emails 14, 7 and 1 days before
  `free_until` ends (Q5). If it passes with no payment info, `overdue_since` = the start of the day
  after `free_until`, and section 5 applies from day 1.
- In Stripe the free time is the subscription's trial (`trial_end` = the first 1st after
  `free_until`), and the stub until that 1st is a one-off invoice created by the billing job on the
  first paid day.

## 7. Mobile

There is no billing UI and there will be none. The only change: on `403 account_paused`, every role
sees the paused message above and nothing else. No price, no link to safeturns.com.

## 8. Build order (when approved)

1. Migration + `billingAccess()` pure function + its unit tests (no Stripe yet).
2. Proration function + tests (both examples, January and March).
3. Stripe test-mode client, Checkout/Portal routes, webhook, test-clock integration tests.
4. Sweep jobs (emails, pause_collection, lock writes) + Render cron.
5. Web Billing page, banners, paused screen; mobile paused screen.
6. `set-free-until.js`.

## 9. Open questions

1. **Lock time:** 22:00 on **day 8** (end of the read-only window, plan assumes this) or day 9?
2. **Forgotten check-outs:** a session nobody checks out stays open forever and would block the lock
   forever. Ignore open sessions older than N hours (say 14) for the lock decision?
3. **`lock_pending`:** plan refuses new check-ins after lock time while existing runs finish. OK, or
   should new runs still be allowed until 22:00 the next day?
4. **"One free month":** Mar 13 → free through Apr 12 (plan), or through the end of the next
   calendar month?
5. **Reminder emails before `free_until`:** 14, 7 and 1 days before?
6. **Stub charge timing:** the days from the end of the free period to the 1st are charged **up
   front on the first paid day** (plan). Or put them on the 1st's bill?
7. **Rounding:** one rounding per van event line (plan). With the real price, the lines of a month
   can differ by a cent from rounding the month's total once. OK?
8. **Cutoff meaning:** `BILLING_FREE_CUTOFF` = the **first billed day** (plan). And "joined" = the
   company's `created_at` in its timezone?
9. **Canceled, then restarted:** no new free month (plan)?
10. **Customer Portal:** may admins cancel from Stripe's portal too, or only from our Billing page?
    (Plan: only ours, so the cancel rules stay in one place.)
11. **Sales tax:** Stripe Tax now, or later?
12. **Stripe receipts and invoices:** to every company_admin, or one billing email per company?
