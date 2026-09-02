// Shared notification helper for student-event alerts (pickup skipped, no-show reported).
// Reuses the app's existing sendMail() — no new notification system. Extracted once a
// second feature (driver no-show) needed the exact same "notify company + school admins"
// recipient logic that the parent Skip Pickup feature already had.
const pool = require('../db/pool');
const { sendMail } = require('../mail/mailer');

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
async function notifyCompanyAndSchoolAdmins(companyId, schoolId, { subject, text, extraRecipients = [] }) {
  const [companyAdmins, schoolAdmins] = await Promise.all([
    pool.query(`SELECT email FROM users WHERE company_id = $1 AND role = 'company_admin' AND is_active`, [companyId]).then((r) => r.rows),
    pool.query(`SELECT email FROM users WHERE school_id = $1 AND role = 'school_admin' AND is_active`, [schoolId]).then((r) => r.rows),
  ]);
  const recipients = [
    ...new Set([...companyAdmins.map((u) => u.email), ...schoolAdmins.map((u) => u.email), ...extraRecipients]),
  ].filter(Boolean);

  await Promise.all(recipients.map((to) => sendMail({ to, subject, text })));
  return recipients;
}

module.exports = { notifyCompanyAndSchoolAdmins };
