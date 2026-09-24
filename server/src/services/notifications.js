// Shared notification helper for student-event alerts (pickup skipped, no-show reported).
// Reuses the app's existing sendMail() — no new notification system. Extracted once a
// second feature (driver no-show) needed the exact same "notify company + school admins"
// recipient logic that the parent Skip Pickup feature already had.
const pool = require('../db/pool');
const { sendInBackground } = require('../mail/mailer');

// Notifies every active company_admin of `companyId` and every active school_admin of
// `schoolId` (both raw pool — narrow, deliberate cross-tenant reads, same precedent as
// services/schools.js), plus any extra recipients (e.g. the assigned driver, a parent).
//
// companyId is an explicit param, NOT derived from req.db/req.auth.tenantId: the original
// version used req.db.findMany('users', {where:{role:'company_admin'}}), which happened to
// work only because every existing caller (driver's markNoShow, parent's skipPickup) is
// itself company-tenant, so req.db's own scoping incidentally matched. Once a school-tenant
// caller (school_staff/school_admin logging a schedule change) needed this same helper, that
// assumption broke silently: a school-scoped req.db.findMany('users', ...) filters by
// school_id, so company_admin rows (school_id IS NULL) never matched — zero company admins
// notified, no error, just missing recipients. Explicit companyId makes this correct
// regardless of the caller's own tenant type.
//
// Never throws and never waits for email: every caller has already saved its row. The
// recipients are looked up now (a quick query) and each email is sent in the background, after
// the response, so a slow or blocked SMTP server can't hold up a no-show or a skip (it did, live,
// for minutes). A failed lookup or send is logged (event type + error, no PII). Returns the
// recipients the notice is being sent to.
async function notifyCompanyAndSchoolAdmins(companyId, schoolId, { subject, text, extraRecipients = [], event = 'notification' }) {
  let recipients;
  try {
    const [companyAdmins, schoolAdmins] = await Promise.all([
      pool.query(`SELECT email FROM users WHERE company_id = $1 AND role = 'company_admin' AND is_active`, [companyId]).then((r) => r.rows),
      pool.query(`SELECT email FROM users WHERE school_id = $1 AND role = 'school_admin' AND is_active`, [schoolId]).then((r) => r.rows),
    ]);
    recipients = [
      ...new Set([...companyAdmins.map((u) => u.email), ...schoolAdmins.map((u) => u.email), ...extraRecipients]),
    ].filter(Boolean);
  } catch (err) {
    console.error(`[mail] recipient lookup failed event=${event} error=${err?.code ?? ''} ${err?.message ?? err}`);
    return [];
  }

  for (const to of recipients) sendInBackground({ to, subject, text }, event);
  return recipients;
}

module.exports = { notifyCompanyAndSchoolAdmins };
