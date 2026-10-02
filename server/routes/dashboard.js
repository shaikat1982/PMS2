import { Router } from 'express';
import { all, get, localDay } from '../db.js';
import { loadMilestones } from '../planning.js';
import { queryTasks } from '../taskQuery.js';
import { addDays, idParam, localDate } from '../util.js';

const router = Router();

router.get('/', async (req, res) => {
  const spaceId = req.query.space_id ? idParam(req.query.space_id, 'space_id') : null;
  const scope = spaceId ? ' AND p.space_id = ?' : '';
  const sp = spaceId ? [spaceId] : [];
  const today = localDate();
  const weekEnd = addDays(today, 7);
  const weekAgo = addDays(today, -6);
  const start = addDays(today, -13);
  const FROM = 'FROM tasks t JOIN projects p ON p.id = t.project_id WHERE 1 = 1';
  const taskScope = spaceId ? ['p.space_id = ?'] : [];

  const [totals, byStatus, byPriority, bySpace, projects, workload, created, completed, upcoming, overdue, mine, activity, milestoneProjects] = await Promise.all([
    get(
      `SELECT COUNT(*) AS total,
         COUNT(*) FILTER (WHERE t.status = 'done') AS done,
         COUNT(*) FILTER (WHERE t.status = 'in_progress') AS in_progress,
         COUNT(*) FILTER (WHERE t.status = 'blocked') AS blocked,
         COUNT(*) FILTER (WHERE t.status != 'done' AND t.due_date < ?) AS overdue,
         COUNT(*) FILTER (WHERE t.status != 'done' AND t.due_date BETWEEN ? AND ?) AS due_this_week,
         COUNT(*) FILTER (WHERE t.status = 'done' AND ${localDay('t.completed_at')} >= ?) AS completed_this_week
       ${FROM}${scope}`,
      today, today, weekEnd, weekAgo, ...sp,
    ),
    all(`SELECT t.status, COUNT(*) AS count ${FROM}${scope} GROUP BY t.status`, ...sp),
    all(`SELECT t.priority, COUNT(*) AS count ${FROM} AND t.status != 'done'${scope} GROUP BY t.priority`, ...sp),
    all(
      `SELECT s.id, s.name, s.color, COUNT(t.id) AS total, COUNT(t.id) FILTER (WHERE t.status = 'done') AS done,
         COUNT(t.id) FILTER (WHERE t.status != 'done' AND t.due_date < ?) AS overdue
       FROM spaces s LEFT JOIN projects p ON p.space_id = s.id LEFT JOIN tasks t ON t.project_id = p.id
       ${spaceId ? 'WHERE s.id = ?' : ''} GROUP BY s.id ORDER BY s.position, s.id`,
      today, ...sp,
    ),
    all(
      `SELECT p.id, p.name, p.color, p.due_date, p.status, s.name AS space_name, s.color AS space_color,
         COUNT(t.id) AS total, COUNT(t.id) FILTER (WHERE t.status = 'done') AS done,
         COUNT(t.id) FILTER (WHERE t.status != 'done' AND t.due_date < ?) AS overdue
       FROM projects p JOIN spaces s ON s.id = p.space_id LEFT JOIN tasks t ON t.project_id = p.id
       WHERE p.status IN ('active', 'on_hold')${scope}
       GROUP BY p.id, s.id ORDER BY overdue DESC, p.due_date IS NULL, p.due_date, p.name`,
      today, ...sp,
    ),
    all(
      `SELECT u.id, u.name, u.color, u.title,
         COUNT(t.id) AS open,
         COUNT(t.id) FILTER (WHERE t.due_date < ?) AS overdue,
         COUNT(t.id) FILTER (WHERE t.priority IN ('urgent', 'high')) AS high_priority,
         COALESCE(SUM(t.estimate_hours), 0) AS estimate_hours
       FROM users u
       LEFT JOIN task_assignees ta ON ta.user_id = u.id
       LEFT JOIN tasks t ON t.id = ta.task_id AND t.status != 'done'
         ${spaceId ? 'AND t.project_id IN (SELECT id FROM projects WHERE space_id = ?)' : ''}
       WHERE u.active
       GROUP BY u.id ORDER BY open DESC, u.name`,
      today, ...sp,
    ),
    // 14-day trend of created vs completed tasks, by calendar day in the app's time zone.
    all(`SELECT ${localDay('t.created_at')} AS d, COUNT(*) AS n ${FROM} AND ${localDay('t.created_at')} >= ?${scope} GROUP BY 1`, start, ...sp),
    all(`SELECT ${localDay('t.completed_at')} AS d, COUNT(*) AS n ${FROM} AND t.status = 'done' AND ${localDay('t.completed_at')} >= ?${scope} GROUP BY 1`, start, ...sp),
    queryTasks({ where: [...taskScope, "t.status != 'done'", 't.due_date >= ?'], params: [...sp, today], order: 't.due_date, t.priority', limit: 10 }),
    queryTasks({ where: [...taskScope, "t.status != 'done'", 't.due_date < ?'], params: [...sp, today], order: 't.due_date', limit: 10 }),
    queryTasks({
      where: [...taskScope, "t.status != 'done'", 'EXISTS (SELECT 1 FROM task_assignees x WHERE x.task_id = t.id AND x.user_id = ?)'],
      params: [...sp, req.user.id], order: 't.due_date IS NULL, t.due_date', limit: 8,
    }),
    all(
      `SELECT a.*, u.name AS user_name, u.color AS user_color, t.title AS task_title, p.name AS project_name
       FROM activity a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN tasks t ON t.id = a.task_id
       LEFT JOIN projects p ON p.id = a.project_id
       ${spaceId ? 'WHERE p.space_id = ?' : ''}
       ORDER BY a.id DESC LIMIT 20`,
      ...sp,
    ),
    all(
      `SELECT p.id, p.name, p.color FROM projects p WHERE p.status IN ('active', 'on_hold')${spaceId ? ' AND p.space_id = ?' : ''}
         AND EXISTS (SELECT 1 FROM milestones m WHERE m.project_id = p.id)`,
      ...sp,
    ),
  ]);

  const trend = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(start, i);
    return { date: d, created: created.find((r) => r.d === d)?.n || 0, completed: completed.find((r) => r.d === d)?.n || 0 };
  });

  // Open milestones across active projects, overdue first, then by target date.
  const milestones = (await Promise.all(milestoneProjects.map(async (p) => (await loadMilestones(p.id, today))
    .filter((m) => m.state !== 'completed' && m.target_date)
    .map((m) => ({ ...m, project_name: p.name, project_color: p.color })))))
    .flat()
    .sort((a, b) => (b.state === 'delayed') - (a.state === 'delayed') || a.target_date.localeCompare(b.target_date))
    .slice(0, 10);

  res.json({ totals, byStatus, byPriority, bySpace, projects, workload, trend, upcoming, overdue, mine, activity, milestones });
});

export default router;
