import { Router } from 'express';
import { all, get, run } from '../db.js';
import { APP_URL, mailEnabled, mailStatus, queueEmail, renderEmail } from '../mailer.js';
import { getPrefs, savePrefs } from '../notify.js';
import { badRequest, idParam } from '../util.js';

const router = Router();

const unreadCount = (userId) => get('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND NOT read', userId);

router.get('/', async (req, res) => {
  const [items, { unread }] = await Promise.all([
    all(
      `SELECT n.*, u.name AS actor_name, u.color AS actor_color, t.title AS task_title
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       LEFT JOIN tasks t ON t.id = n.task_id
       WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`,
      req.user.id,
    ),
    unreadCount(req.user.id),
  ]);
  res.json({ items, unread });
});

router.get('/unread', async (req, res) => {
  res.json(await unreadCount(req.user.id));
});

router.get('/preferences', async (req, res) => {
  const status = await mailStatus();
  res.json({ prefs: await getPrefs(req.user.id), email: req.user.role === 'admin' ? status : { enabled: status.enabled } });
});

router.put('/preferences', async (req, res) => {
  const prefs = req.body?.prefs;
  if (!Array.isArray(prefs)) throw badRequest('prefs must be a list');
  await savePrefs(req.user.id, prefs);
  res.json({ prefs: await getPrefs(req.user.id) });
});

router.post('/test-email', async (req, res) => {
  if (!mailEnabled()) throw badRequest('Email is not set up on this server. An admin needs to set SMTP_HOST and related settings.');
  await queueEmail(req.user.email, 'Instacall PM test email', renderEmail({
    heading: 'Email notifications are working',
    lines: [`This test was sent to ${req.user.email}.`],
    actionUrl: APP_URL,
  }));
  res.json({ ok: true, to: req.user.email });
});

router.post('/read-all', async (req, res) => {
  await run('UPDATE notifications SET read = TRUE WHERE user_id = ? AND NOT read', req.user.id);
  res.status(204).end();
});

router.post('/:id/read', async (req, res) => {
  await run('UPDATE notifications SET read = TRUE WHERE id = ? AND user_id = ?', idParam(req.params.id), req.user.id);
  res.status(204).end();
});

export default router;
