// Shared notification helper for student-event alerts (pickup skipped, no-show reported).
// Reuses the app's existing sendMail() — no new notification system. Extracted once a
// second feature (driver no-show) needed the exact same "notify company + school admins"
// recipient logic that the parent Skip Pickup feature already had.
const pool = require('../db/pool');
const { sendMail } = require('../mail/mailer');

// Notifies every active company_admin (via req.db, same tenant) and every active
// school_admin of the given school (raw pool — narrow, deliberate cross-tenant read, same
// precedent as services/schools.js), plus any extra recipients (e.g. the assigned driver).
async function notifyCompanyAndSchoolAdmins(req, schoolId, { subject, text, extraRecipients = [] }) {
  const [companyAdmins, schoolAdmins] = await Promise.all([
    req.db.findMany('users', { where: { role: 'company_admin', is_active: true } }),
    pool
      .query(`SELECT email FROM users WHERE school_id = $1 AND role = 'school_admin' AND is_active`, [schoolId])
      .then((r) => r.rows),
  ]);
  const recipients = [
    ...new Set([...companyAdmins.map((u) => u.email), ...schoolAdmins.map((u) => u.email), ...extraRecipients]),
  ].filter(Boolean);

  await Promise.all(recipients.map((to) => sendMail({ to, subject, text })));
  return recipients;
}

module.exports = { notifyCompanyAndSchoolAdmins };
