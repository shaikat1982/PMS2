import { all, get, run } from './db.js';
import { APP_URL, mailEnabled, queueEmail, renderEmail } from './mailer.js';

/** Every kind of notification, with whether in-app and email are on until a user changes them. */
export const EVENTS = [
  { key: 'assigned', label: 'Assigned to a task', in_app: true, email: true },
  { key: 'mentioned', label: '@mentioned in a comment', in_app: true, email: true },
  { key: 'commented', label: 'New comment on my tasks', in_app: true, email: true },
  { key: 'status', label: 'Status changed on my tasks', in_app: true, email: false },
  { key: 'priority', label: 'Priority changed on my tasks', in_app: true, email: false },
  { key: 'due_date', label: 'Due date changed on my tasks', in_app: true, email: false },
  { key: 'attachment', label: 'File attached to my tasks', in_app: true, email: false },
  { key: 'due_soon', label: 'Task due tomorrow (reminder)', in_app: true, email: true },
  { key: 'overdue', label: 'Task or milestone overdue', in_app: true, email: true },
];
const EVENT_KEYS = EVENTS.map((e) => e.key);

export async function getPrefs(userId) {
  const saved = Object.fromEntries((await all('SELECT * FROM notification_prefs WHERE user_id = ?', userId)).map((p) => [p.event, p]));
  return EVENTS.map((e) => ({
    event: e.key,
    label: e.label,
    in_app: saved[e.key] ? saved[e.key].in_app : e.in_app,
    email: saved[e.key] ? saved[e.key].email : e.email,
  }));
}

export async function savePrefs(userId, prefs) {
  for (const p of prefs) {
    if (!EVENT_KEYS.includes(p.event)) continue;
    await run(
      `INSERT INTO notification_prefs (user_id, event, in_app, email) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, event) DO UPDATE SET in_app = excluded.in_app, email = excluded.email`,
      userId, p.event, !!p.in_app, !!p.email,
    );
  }
}

/**
 * Notify users in-app and/or by email, according to each person's preferences.
 * The actor never gets notified about their own change. url is used for notifications
 * not tied to a task (milestones); quote adds context such as the comment text to emails.
 */
export async function notify(userIds, actorId, taskId, message, event, { url = null, quote = null } = {}) {
  const ids = [...new Set(userIds)].filter((uid) => uid && uid !== actorId);
  if (!ids.length) return;
  const task = taskId
    ? await get('SELECT t.title, p.name AS project_name FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?', taskId)
    : null;
  const def = EVENTS.find((e) => e.key === event) || { in_app: true, email: false };
  const recipients = await all(
    `SELECT u.id, u.email, np.in_app, np.email AS email_on FROM users u
     LEFT JOIN notification_prefs np ON np.user_id = u.id AND np.event = ?
     WHERE u.id = ANY(?::int[]) AND u.active`,
    event, ids,
  );
  for (const user of recipients) {
    const inApp = user.in_app ?? def.in_app;
    const email = user.email_on ?? def.email;
    if (inApp) {
      await run('INSERT INTO notifications (user_id, actor_id, task_id, message, event, url) VALUES (?, ?, ?, ?, ?, ?)', user.id, actorId, taskId, message, event, url);
    }
    if (email && mailEnabled()) {
      const actionUrl = taskId ? `${APP_URL}/?task=${taskId}` : url ? `${APP_URL}${url}` : APP_URL;
      const lines = task ? [`Task: ${task.title}`, `Project: ${task.project_name}`] : [];
      await queueEmail(user.email, message, renderEmail({ heading: message, lines, quote, actionUrl }));
    }
  }
}
