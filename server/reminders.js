import { all, get, run, tx } from './db.js';
import { notify } from './notify.js';
import { cleanOrphanFiles } from './api/attachments.js';
import { addDays, localDate } from './util.js';

/** Record a reminder; returns false when it was already sent for this due date. */
const claim = async (type, id, kind, due) => (await run(
  'INSERT INTO reminders_sent (item_type, item_id, kind, due_date) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING', type, id, kind, due,
)).changes > 0;

const assignees = async (taskId) => (await all('SELECT user_id FROM task_assignees WHERE task_id = ?', taskId)).map((r) => r.user_id);

/**
 * Due-tomorrow and overdue alerts for tasks, and overdue alerts for milestones.
 * Each goes out once per due date, so moving a deadline re-arms the reminder. The
 * reminders_sent row is claimed and the notification written in one transaction, so
 * with several app instances each reminder is still sent exactly once.
 */
export async function sendReminders() {
  const today = localDate();
  const tomorrow = addDays(today, 1);

  for (const t of await all("SELECT id, title, due_date FROM tasks WHERE status != 'done' AND due_date = ?", tomorrow)) {
    await tx(async () => {
      if (await claim('task', t.id, 'due_soon', t.due_date)) await notify(await assignees(t.id), null, t.id, `"${t.title}" is due tomorrow`, 'due_soon');
    });
  }
  // Only alert about recently missed deadlines, so a long-running database doesn't flood inboxes.
  for (const t of await all("SELECT id, title, due_date, created_by FROM tasks WHERE status != 'done' AND due_date < ? AND due_date >= ?", today, addDays(today, -7))) {
    await tx(async () => {
      if (await claim('task', t.id, 'overdue', t.due_date)) {
        await notify([...await assignees(t.id), t.created_by], null, t.id, `"${t.title}" is overdue (was due ${t.due_date})`, 'overdue');
      }
    });
  }
  for (const m of await all(
    `SELECT m.id, m.name, m.target_date, m.owner_id, m.project_id, m.progress_mode, p.owner_id AS project_owner
     FROM milestones m JOIN projects p ON p.id = m.project_id
     WHERE m.status != 'completed' AND m.target_date < ? AND m.target_date >= ?`,
    today, addDays(today, -7),
  )) {
    // Auto-progress milestones can be complete through their tasks even though the stored status isn't.
    const open = await get("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status != 'done') AS open FROM tasks WHERE milestone_id = ?", m.id);
    if (m.progress_mode === 'auto' && open.total > 0 && open.open === 0) continue;
    await tx(async () => {
      if (await claim('milestone', m.id, 'overdue', m.target_date)) {
        await notify([m.owner_id, m.project_owner], null, null, `Milestone "${m.name}" is overdue (target ${m.target_date})`, 'overdue', {
          url: `/projects/${m.project_id}?tab=planning&item=MS-${m.id}`,
        });
      }
    });
  }
}

/** Reminders and attachment cleanup. Also run by /api/cron on hosts without long-running processes. */
export async function runHourlyJobs() {
  await sendReminders();
  await cleanOrphanFiles();
}

export function startJobs() {
  if (globalThis.__instacallJobTimer) return;
  const runAll = () => runHourlyJobs().catch((err) => console.error('Background job failed:', err));
  setTimeout(runAll, 5000).unref?.();
  globalThis.__instacallJobTimer = setInterval(runAll, 60 * 60 * 1000);
  globalThis.__instacallJobTimer.unref?.();
}
