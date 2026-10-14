// Notifications (branch push-notifications; services/push.js).
//   GET    /notifications/web-push-key   public: the VAPID public key the website subscribes with
//   DELETE /notifications/devices        public on purpose: stop pushes to this device (logout,
//                                         or a session that already expired). Body { token }.
//   POST   /notifications/devices        register this device for the signed-in person
//   GET    /notifications                the person's list (newest first) + unread_count
//   GET    /notifications/unread-count   just the bell's number
//   POST   /notifications/read-all       mark everything read
//   POST   /notifications/:id/read       mark one read
// Every role can use these: each person only ever sees their own notifications.
const express = require('express');
const authenticate = require('../middleware/authenticate');
const { requireOperable } = require('../middleware/authorize');
const config = require('../config');
const {
  registerDevice, unregisterDevice, listNotifications, unreadCount, markRead, markAllRead, webPushConfigured,
} = require('../services/push');

const router = express.Router();

router.get('/web-push-key', (req, res) => {
  res.json({ public_key: webPushConfigured() ? config.vapidPublicKey : null });
});
router.delete('/devices', async (req, res, next) => {
  try { await unregisterDevice(req.body || {}); res.status(204).end(); } catch (e) { next(e); }
});

router.use(authenticate, requireOperable);

router.post('/devices', async (req, res, next) => {
  try { res.status(201).json(await registerDevice(req, req.body || {})); } catch (e) { next(e); }
});
router.get('/', async (req, res, next) => {
  try { res.json(await listNotifications(req, req.query)); } catch (e) { next(e); }
});
router.get('/unread-count', async (req, res, next) => {
  try { res.json({ unread_count: await unreadCount(req.auth.userId) }); } catch (e) { next(e); }
});
router.post('/read-all', async (req, res, next) => {
  try { res.json(await markAllRead(req)); } catch (e) { next(e); }
});
router.post('/:id/read', async (req, res, next) => {
  try { res.json(await markRead(req, req.params.id)); } catch (e) { next(e); }
});

module.exports = router;
