import { all, get, run } from '../db.js';
import { APP_URL, mailEnabled, mailStatus, queueEmail, renderEmail } from '../mailer.js';
import { getPrefs, savePrefs } from '../notify.js';
import { badRequest, idParam } from '../util.js';

const unreadCount = (userId) => get('SELECT COUNT(*) AS unread FROM notifications WHERE user_id = ? AND NOT read', userId);

export async function list({ user }) {
  const [items, { unread }] = await Promise.all([
    all(
      `SELECT n.*, u.name AS actor_name, u.color AS actor_color, t.title AS task_title
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       LEFT JOIN tasks t ON t.id = n.task_id
       WHERE n.user_id = ? ORDER BY n.id DESC LIMIT 100`,
      user.id,
    ),
    unreadCount(user.id),
  ]);
  return { items, unread };
}

export async function unread({ user }) {
  return await unreadCount(user.id);
}

export async function preferences({ user }) {
  const status = await mailStatus();
  return { prefs: await getPrefs(user.id), email: user.role === 'admin' ? status : { enabled: status.enabled } };
}

export async function savePreferences({ user, body }) {
  const prefs = body.prefs;
  if (!Array.isArray(prefs)) throw badRequest('prefs must be a list');
  await savePrefs(user.id, prefs);
  return { prefs: await getPrefs(user.id) };
}

export async function testEmail({ user }) {
  if (!mailEnabled()) throw badRequest('Email is not set up on this server. An admin needs to set SMTP_HOST and related settings.');
  await queueEmail(user.email, 'Instacall PM test email', renderEmail({
    heading: 'Email notifications are working',
    lines: [`This test was sent to ${user.email}.`],
    actionUrl: APP_URL,
  }));
  return { ok: true, to: user.email };
}

export async function readAll({ user }) {
  await run('UPDATE notifications SET read = TRUE WHERE user_id = ? AND NOT read', user.id);
  return;
}

export async function markRead({ user, params }) {
  await run('UPDATE notifications SET read = TRUE WHERE id = ? AND user_id = ?', idParam(params.id), user.id);
  return;
}

