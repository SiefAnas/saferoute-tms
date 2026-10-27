# Subscription plan (branch `subscription-plan`)

Plan only. No code, no migration, nothing merged. Open questions are at the end; the sections
before them mark each assumption that depends on an answer.

Ground rules from the brief:
- SafeTurns is billed **monthly, per active van**, paid on **safeturns.com** (the web client).
- **Nothing can be bought in the mobile app.** The app is login only: no prices, no "upgrade", no
  link to a payment page.
- **Only `company_admin`** sees or changes billing.

## 1. What exists today

- **Billing page** (`client/src/pages/company/BillingPage.tsx`, Settings > Billing, company_admin
  only): read only. Shows "Pilot - free through the end of the year" and five usage counts
  (students, drivers, monitors, vans, schools). No payment method, invoices or upgrades, on purpose.
- **API**: `GET /companies/me/billing` and `GET /companies/me/usage` (`server/src/routes/companies.js`,
  behind `requireOperable` + `requireRole('company_admin')`). Counts come from one shared SQL in
  `server/src/services/usage.js`.
- **DB** (migration 030, account-settings): `companies.billing_plan` (CHECK: only `'pilot'`),
  `companies.billing_status` (CHECK: only `'free'`, `'closing'`), `companies.trial_ends_at` (unused),
  plus `usage_snapshots` (one row per company per day).
- **Snapshot job**: `server/scripts/snapshot-usage.js` writes the daily counts, but is **not
  scheduled anywhere** and uses the database's `CURRENT_DATE`, not the company's timezone.
- **Vans have no active flag.** `vans` rows are hard rows with no `is_active` / `retired_at`; the
  usage "vans" count is every van the company has. "Active van" is therefore not defined yet.
- **Closure** (`companies.closure_*`, `services/closure.js`) sets `billing_status = 'closing'` and
  undo puts it back to `'free'` (ACCOUNT_SETTINGS_QUESTIONS #2 already flagged that paid plans need
  to remember the status before closure).
- **Company timezone** exists (`companies.timezone`, `server/src/time/businessDate.js`).
- **No payment provider, no webhook route, no payment data anywhere.** Mobile has no billing code.

## 2. Database

Assumption: Stripe as the provider (Q1). Names are generic so another provider fits the same shape.
No card data is ever stored; the provider holds it.

### `subscriptions`: exactly one per company

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid, **unique**, FK companies ON DELETE RESTRICT | one subscription per company; billing history must not vanish with a cascade (the purge design decides) |
| `status` | text, CHECK | `pilot`, `trialing`, `active`, `past_due`, `suspended`, `canceled` (section 5) |
| `provider` | text | `'stripe'` |
| `provider_customer_id` | text, unique | null until the admin first goes to checkout |
| `provider_subscription_id` | text, unique | null until checkout completes |
| `price_per_van_cents` | integer | copied from the provider price at checkout, for display |
| `currency` | text | `'usd'` |
| `billing_day` | smallint 1-28 | the day of month the period renews (Q4) |
| `current_period_start` / `current_period_end` | timestamptz | mirrored from the provider |
| `billed_van_count` | integer | the count on the last invoice (display) |
| `past_due_since` | timestamptz | first failed payment of the current episode; null when paid |
| `grace_ends_at` | timestamptz | `past_due_since + grace days`; never extended by retries |
| `cancel_at_period_end` | boolean | admin asked to stop at the end of the period |
| `canceled_at` | timestamptz | |
| `status_before_closure` | text | fixes the closure-undo gap (ACCOUNT_SETTINGS_QUESTIONS #2) |
| `created_at` / `updated_at` | timestamptz | `updated_at` trigger like the other tables |

Every existing claimed company gets a row with `status = 'pilot'` in the migration. Placeholder
(unclaimed) companies get none.

### `billing_periods`: one row per company per billed month

| column | notes |
|---|---|
| `id`, `subscription_id` FK | |
| `period_start`, `period_end` (date, company timezone) | unique (`subscription_id`, `period_start`) |
| `van_count` | the measured count (section 3) |
| `van_ids` (uuid[]) | which vans were counted: answers "why was I billed for 7?" |
| `measured_at` | |
| `provider_invoice_id` (unique), `amount_cents`, `invoice_status` (`draft`/`open`/`paid`/`uncollectible`/`void`), `hosted_invoice_url` | filled by webhooks |

This is the invoice list on the Billing page; we never render invoices ourselves, we link to the
provider's hosted invoice.

### `billing_events`: webhook log and idempotency

| column | notes |
|---|---|
| `provider_event_id` | **unique**: a redelivered event is a no-op |
| `type`, `payload` (jsonb), `received_at`, `processed_at`, `error` | |
| `company_id` | nullable; resolved from the customer id |

### Changes to existing tables

- `vans.retired_at timestamptz` (null = active). Retiring a van is a soft action in the fleet UI;
  retired vans can't be assigned. Needed whatever the answer to Q2 is, unless "active" ends up
  meaning "every van row".
- `companies.billing_plan` / `billing_status`: stop being the source of truth.
  `GET /companies/me/billing` reads `subscriptions` instead. Drop the two columns in a later
  migration once nothing reads them (closure moves to `subscriptions.status_before_closure`).
- `usage_snapshots.active_vans integer` alongside the existing `vans` (all rows), so history
  shows both.

## 3. Measuring the van count on the billing day

Billing is **in arrears**: on the billing day we bill the month that just ended (Q3).

1. **Daily snapshot, made real.** Schedule `snapshot-usage.js` once a day (Render cron) and change
   "today" to each company's business date (`businessDate.js`), so a company's day is its own
   timezone's day. Each row records `active_vans` = vans of the company with `retired_at IS NULL`.
2. **Billing job**, run hourly. For every subscription whose `current_period_end` has passed and
   has no `billing_periods` row for that period:
   - `van_count` = **the highest `active_vans` of any daily snapshot inside the period**
     (recommended, Q2). This stops "retire 5 vans the night before billing, un-retire them the
     morning after". Alternative: the count at the moment the job runs (simpler, gameable).
   - If a day's snapshot is missing (job down), compute it from the live count at job time and log
     a warning; never bill zero by accident.
   - Minimum 1 van (Q5) so a company with 0 vans is not on a free paid plan.
   - Write the `billing_periods` row, then send the quantity to the provider for that period
     (Stripe: report usage for the subscription item / set the quantity on the draft invoice
     before it finalizes). One transaction for our row; the provider call uses an idempotency key
     of `subscription_id + period_start`, so a retried job never bills twice.
3. Hourly + idempotent means the job can be late or run twice and still bill exactly once per
   period.

Edge cases:
- A van created and retired inside the same period counts if it appeared in a daily snapshot.
- First month: from checkout to the first billing day; prorate or not is Q6.
- Mid-month cancellation: the final period is billed on its normal day with the same rule.

## 4. Payment provider webhook

`POST /billing/webhook`, mounted **before** `express.json()` (signature check needs the raw
body), no session auth, own rate limiter.

1. Verify the provider signature with `BILLING_WEBHOOK_SECRET`. Bad signature → `400`, nothing
   written.
2. `INSERT INTO billing_events ... ON CONFLICT (provider_event_id) DO NOTHING`. Already there and
   processed → `200` (redelivery).
3. Do not trust the payload's ordering: events arrive late and out of order. For any
   subscription/invoice event, **re-fetch the subscription (or invoice) from the provider API** and
   write that current state. That makes every handler "sync to the truth" rather than "apply this
   delta".
4. Update `subscriptions` / `billing_periods` in one transaction, set `processed_at`, return `200`.
   Any error → `500` with `error` stored, so the provider retries.

| event (Stripe names) | effect |
|---|---|
| `checkout.session.completed` | link `provider_customer_id` / `provider_subscription_id`; status from the provider (`active` or `trialing`) |
| `invoice.finalized` | fill `provider_invoice_id`, `amount_cents`, `hosted_invoice_url` on the period row |
| `invoice.paid` | period `paid`; subscription `active`; clear `past_due_since` / `grace_ends_at` |
| `invoice.payment_failed` | subscription `past_due`; set `past_due_since` and `grace_ends_at` **only if not already set**; email the company admins (first failure only) |
| `customer.subscription.updated` | sync status, period dates, `cancel_at_period_end` |
| `customer.subscription.deleted` | `canceled`, `canceled_at` |

Our own state machine decides `suspended` (section 5); the provider never sets it.

Only company_admin reaches anything that starts a payment:
- `POST /companies/me/billing/checkout` → returns a provider-hosted checkout URL.
- `POST /companies/me/billing/portal` → returns the provider's customer portal URL (change card,
  see invoices, cancel).
- Both behind `requireRole('company_admin')`, like the existing billing routes. The web app
  redirects; it never sees card numbers.
- Return URLs point to `https://safeturns.com/company/billing` only (fixed in config, not taken from
  the request).

## 5. Failed payments: past due and grace period

```
pilot ──checkout──> active <──paid──┐
                      │             │
              payment fails         │
                      v             │
                  past_due ─────────┤   (provider retries the card during grace)
                      │             │
             grace_ends_at passes   │
                      v             │
                  suspended ────────┘
                      │
        N days suspended, or admin cancels
                      v
                  canceled ──> closure flow (existing, 30-day purge)
```

- **Day 0, payment fails → `past_due`.** Everyone keeps working. Company admins get an email and a
  banner on every web page: "Your payment failed. Update your card by {date}." Link → portal.
  Nobody else sees it (drivers, monitors, school staff, parents).
- **Grace period** (recommended 14 days, Q7). The provider retries the card on its own schedule;
  any success → `active`, banner gone. Reminder emails on day 7 and the day before grace ends.
- **Grace ends, still unpaid → `suspended`** (hourly job compares `grace_ends_at` to now).
  Recommended effect (Q8):
  - **Daily operations keep running.** Drivers and monitors can still sign in, check in and out,
    and run pickups. Cutting off a route with children on board is a safety problem, not a billing
    lever.
  - Company admin web: read only, except the Billing page, which stays fully usable so they can
    pay. Banner says the account is suspended.
  - Mobile shows nothing about money. At most a neutral "Contact your company admin" if a blocked
    action is attempted.
- **Paid while suspended → `active` immediately** (webhook), no manual step.
- **Still unpaid after N more days → `canceled`**, which hands over to the existing closure flow
  (Q9).
- A new failure after a successful payment starts a fresh episode (new `past_due_since`).

Enforcement lives in one middleware next to `requireOperable` (e.g. `requireBillingOk`), reading
the subscription status cached on `req.auth`, so the rule is in one place and testable.

## 6. Mobile

No change, by design. No billing screen, no price, no link to safeturns.com/pricing (App Store
and Play rules on external purchase links). A `company_admin` signing into the app sees the same
app as today.

## 7. Open questions

1. **Provider**: Stripe? (The plan assumes it.) Do you already have an account, and in which
   legal entity's name?
2. **"Active van"**: a van not retired (needs the new `retired_at`), or a van that actually ran at
   least one trip in the month? And is it the **highest count during the month** (recommended) or
   the count **on the billing day** only?
3. **Arrears or advance**: bill the month that just ended (plan assumes this), or charge up front
   for the coming month?
4. **Billing day**: one day for everyone (e.g. the 1st), or each company's checkout anniversary?
5. **Price per van**, and is there a **minimum** (e.g. at least 1 van, or a monthly floor)?
6. **First month and mid-month changes**: prorate, or full month?
7. **Grace period length**: 14 days?
8. **What "suspended" blocks**: is "drivers and monitors keep working, admin is read only" right?
   Or do you want something stricter / looser?
9. **After suspension**: how many days until `canceled`, and does cancel start the 30-day
   closure/purge automatically?
10. **Pilot companies**: on 2027-01-01 do they (a) need to enter a card before then, (b) get a free
    trial of N days, (c) stay free until you flip them by hand? What happens if they never pay?
11. **Taxes**: collect sales tax (Stripe Tax), or not for now?
12. **Invoices**: who receives them, every company_admin of the company or one billing email you
    set on the company?
13. **Several company_admins**: may any of them change the card or cancel, or only one "owner"?
14. **Who gets counted**: confirm billing is vans only, not drivers/monitors/students.
15. **Annual plans or discounts** later? (Changes the table only slightly; better to know now.)
