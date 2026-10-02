import { all, get, localDay } from './db.js';
import { loadMilestones, loadPhases, loadReleases, projectProgress, refOf, taskState } from './planning.js';
import { addDays, daysBetween, localDate } from './util.js';

const variance = (planned, actual) => (planned && actual ? daysBetween(planned, actual) : null);

/** Progress, bug and team reports for one project. */
export async function projectReports(project) {
  const today = localDate();
  const [phases, milestones, releases, tasks, overdueTaskRows, bugs, team] = await Promise.all([
    loadPhases(project.id, today),
    loadMilestones(project.id, today),
    loadReleases(project.id, today),
    get(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'done') AS done,
         COUNT(*) FILTER (WHERE status IN ('in_progress', 'review')) AS in_progress, COUNT(*) FILTER (WHERE status = 'blocked') AS blocked,
         COUNT(*) FILTER (WHERE status != 'done' AND due_date < ?) AS overdue
       FROM tasks WHERE project_id = ?`,
      today, project.id,
    ),
    all(
      `SELECT id, title, due_date, status, priority, type FROM tasks
       WHERE project_id = ? AND status != 'done' AND due_date < ? ORDER BY due_date LIMIT 50`,
      project.id, today,
    ),
    bugReport(project.id, today),
    teamReport(project.id, today),
  ]);

  const overdueTasks = overdueTaskRows.map((t) => ({
    kind: 'task', ref: refOf('task', t.id), id: t.id, name: t.title, planned: t.due_date, days_late: daysBetween(t.due_date, today), status: t.status, type: t.type,
  }));
  const late = (kind, list, dateKey) => list.filter((x) => x.state === 'delayed').map((x) => ({
    kind, ref: x.ref, id: x.id, name: x.name, planned: x[dateKey], days_late: daysBetween(x[dateKey], today),
  }));
  const overdueItems = [
    ...late('phase', phases, 'end_date'),
    ...late('milestone', milestones, 'target_date'),
    ...late('release', releases, 'release_date'),
    ...overdueTasks,
  ].sort((a, b) => b.days_late - a.days_late);

  const progress = {
    overall: await projectProgress(project, milestones),
    method: project.progress_method,
    tasks,
    phases: phases.map((p) => ({
      ...p, planned_start: p.start_date, planned_end: p.end_date, actual_end: p.completed_date,
      variance_days: variance(p.end_date, p.completed_date || (p.state === 'delayed' ? today : null)),
    })),
    milestones: milestones.map((m) => ({
      ...m, variance_days: variance(m.target_date, m.completed_date || (m.state === 'delayed' ? today : null)),
    })),
    releases: releases.map((r) => ({
      ...r, variance_days: variance(r.release_date, r.released_date || (r.state === 'delayed' ? today : null)),
    })),
    overdue_items: overdueItems,
  };

  return { progress, bugs, team };
}

async function bugReport(projectId, today) {
  const BUG = "FROM tasks t WHERE t.project_id = ? AND t.type = 'bug'";
  const group = (col, openOnly = true) => all(
    `SELECT COALESCE(NULLIF(${col}, ''), '') AS key, COUNT(*) AS count ${BUG}${openOnly ? " AND t.status != 'done'" : ''}
     GROUP BY 1 ORDER BY 2 DESC`,
    projectId,
  );
  const start = addDays(today, -29);
  const [totals, bySeverity, byStatus, byPriority, byEnvironment, byVersion, byRelease, opened, resolved, open] = await Promise.all([
    get(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE t.status != 'done') AS open, COUNT(*) FILTER (WHERE t.status = 'done') AS closed,
         COUNT(*) FILTER (WHERE t.status != 'done' AND t.severity = 'critical') AS open_critical,
         COUNT(*) FILTER (WHERE t.status != 'done' AND t.due_date < ?) AS overdue,
         AVG(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 86400) FILTER (WHERE t.status = 'done' AND t.completed_at IS NOT NULL) AS avg_resolution_days
       ${BUG}`,
      today, projectId,
    ),
    group('t.severity'),
    group('t.status', false),
    group('t.priority'),
    group('t.environment'),
    group('t.affected_version'),
    all(
      `SELECT r.id, r.name, COUNT(t.id) AS total, COUNT(t.id) FILTER (WHERE t.status != 'done') AS open
       FROM releases r LEFT JOIN tasks t ON t.release_id = r.id AND t.type = 'bug'
       WHERE r.project_id = ? GROUP BY r.id ORDER BY r.release_date IS NULL, r.release_date`,
      projectId,
    ),
    all(`SELECT ${localDay('t.created_at')} AS d, COUNT(*) AS n ${BUG} AND ${localDay('t.created_at')} >= ? GROUP BY 1`, projectId, start),
    all(`SELECT ${localDay('t.completed_at')} AS d, COUNT(*) AS n ${BUG} AND t.status = 'done' AND ${localDay('t.completed_at')} >= ? GROUP BY 1`, projectId, start),
    all(
      `SELECT t.id, t.title, t.status, t.priority, t.severity, t.environment, t.affected_version, t.due_date, t.created_at, r.name AS release_name
       FROM tasks t LEFT JOIN releases r ON r.id = t.release_id
       WHERE t.project_id = ? AND t.type = 'bug' AND t.status != 'done'
       ORDER BY CASE t.severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1 WHEN 'minor' THEN 2 WHEN 'trivial' THEN 3 ELSE 4 END,
         CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at
       LIMIT 100`,
      projectId,
    ),
  ]);

  const trend = Array.from({ length: 30 }, (_, i) => {
    const d = addDays(start, i);
    return { date: d, opened: opened.find((r) => r.d === d)?.n || 0, resolved: resolved.find((r) => r.d === d)?.n || 0 };
  });

  return {
    totals: { ...totals, avg_resolution_days: totals.avg_resolution_days === null ? null : Math.round(totals.avg_resolution_days * 10) / 10 },
    by_severity: bySeverity,
    by_status: byStatus,
    by_priority: byPriority,
    by_environment: byEnvironment,
    by_version: byVersion,
    by_release: byRelease,
    trend,
    open: open.map((t) => ({ ...t, ref: refOf('task', t.id), state: taskState(t, today), age_days: daysBetween(t.created_at.slice(0, 10), today) })),
  };
}

function teamReport(projectId, today) {
  return all(
    `SELECT u.id, u.name, u.color, u.title,
       COUNT(t.id) AS assigned,
       COUNT(*) FILTER (WHERE t.status != 'done') AS open,
       COUNT(*) FILTER (WHERE t.status = 'done') AS done,
       COUNT(*) FILTER (WHERE t.status != 'done' AND t.due_date < ?) AS overdue,
       COUNT(*) FILTER (WHERE t.status != 'done' AND t.type = 'bug') AS open_bugs,
       COALESCE(SUM(t.estimate_hours) FILTER (WHERE t.status != 'done'), 0) AS open_estimate,
       (SELECT COALESCE(SUM(te.hours), 0) FROM time_entries te JOIN tasks tt ON tt.id = te.task_id
         WHERE te.user_id = u.id AND tt.project_id = ?) AS logged_hours
     FROM users u
     JOIN task_assignees ta ON ta.user_id = u.id
     JOIN tasks t ON t.id = ta.task_id AND t.project_id = ?
     GROUP BY u.id ORDER BY open DESC, u.name`,
    today, projectId, projectId,
  );
}
