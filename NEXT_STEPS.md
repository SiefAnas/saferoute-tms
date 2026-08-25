# Next steps — Render env vars (Anas only)

Written 2026-08-25. Nothing in this file has been done for you — every item below needs
your own hands in Render's dashboard. No Claude Code session should be entering API keys
or touching live env vars; that's why this is a checklist instead of something already
applied.

Do these **in this order** — additive, low-risk items first; the one item that touches an
existing, already-working connection string last and on its own, so if anything breaks
afterward it's obvious what caused it.

## 1. SMTP env vars (Resend) — additive, safe to do first

On `saferoute-tms-api` in Render's dashboard → Environment, add:

| Key | Value |
|---|---|
| `SMTP_HOST` | `smtp.resend.com` |
| `SMTP_PORT` | `465` |
| `SMTP_SECURE` | `true` |
| `SMTP_USER` | `resend` |
| `SMTP_PASS` | your Resend API key (starts `re_`) |
| `MAIL_FROM` | see the domain note below before picking a value |

Saving env vars on Render triggers an automatic restart of the service — that's expected,
not a problem. Nothing in the app requires these to be set; `server/src/mail/mailer.js`
only activates the real SMTP path when `SMTP_HOST` is present, so this is safe to add at
any time without breaking anything currently working.

**Domain verification matters here.** Resend accounts start in a restricted mode: until you
verify a sending domain (Resend dashboard → Domains → add the DNS records they give you),
you can only send successfully from their shared `onboarding@resend.dev` address, and only
*to* the email address your Resend account itself is registered under. If `MAIL_FROM` is
set to an address on a domain you haven't verified in Resend, sends will fail (or silently
not reach real users) even though the API key is valid. Two options:
- **Testing now, domain not verified yet:** set `MAIL_FROM=SafeRoute TMS <onboarding@resend.dev>` (the mailer's own default if you leave `MAIL_FROM` unset) and only expect delivery to your own Resend account email while verifying the pipe works.
- **Verified domain:** set `MAIL_FROM` to a real address on that domain, e.g. `SafeRoute TMS <notifications@yourdomain.com>`.

**After setting these**, ping whichever session picks this up next and it can trigger a
real send by hitting a live endpoint that calls `sendMail` (registration or
resend-verification) and confirm delivery — that hasn't been verified end-to-end yet.

## 2. `DATABASE_URL`: `sslmode=require` → `sslmode=verify-full` — do this on its own

Your current `DATABASE_URL` on Render almost certainly ends in `?sslmode=require` (that's
what `server/.env.example` documents, and what a default Neon connection string uses).
`require` encrypts the connection but does **not** verify the server's certificate against
its hostname — it protects against passive eavesdropping but not a man-in-the-middle
presenting any valid-looking certificate. `verify-full` additionally checks the cert chain
and hostname match, closing that gap. Neon supports `verify-full` on its standard
connection strings without any other change needed.

Steps:
1. In Render's dashboard, find `DATABASE_URL` in `saferoute-tms-api`'s Environment tab.
2. Edit the value: change `?sslmode=require` (or `&sslmode=require`, depending on what
   else is in the query string) to `sslmode=verify-full`.
3. Save — this restarts the service.
4. Immediately check `https://saferoute-tms-api.onrender.com/health` returns
   `{"status":"ok"}`. If it doesn't, or the service fails to boot, the connection string
   most likely needs `sslmode=verify-full` plus explicit root-CA info depending on exactly
   how Neon issues its certs — revert to `sslmode=require` and flag it rather than leaving
   the API down.

Do this **after** step 1, and by itself — if something breaks, you'll know it's this
change and not the unrelated SMTP additions.

## Also worth knowing

- `server/BACKUP_RESTORE.md` documents the new daily DB backup workflow — no action needed
  from you there beyond the `DATABASE_URL` repo secret in GitHub (separate from the Render
  env var above; used only by `.github/workflows/db-backup.yml`), which per the original
  task you're setting yourself.
- Once both steps above are done, `TMS_PROJECT_SPEC_1.md` §8's "Real email transport" item
  and this file can both be updated/retired — ping a session to do that once you've
  confirmed a real Resend send actually landed.
