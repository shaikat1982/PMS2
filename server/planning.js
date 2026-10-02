import { all, get, run } from './db.js';
import { addDays, daysBetween, localDate, logActivity } from './util.js';

/*
 * Timeline items are phases, milestones, releases and tasks. Each has a planned span
 * (start → end), a progress percentage and a display state shared by the Gantt chart,
 * the project overview and reports:
 *   completed | in_progress | delayed | not_started  (+ cancelled for releases)
 * "delayed" means the planned end date has passed without the item being completed.
 */

export const ITEM_TYPES = {
  phase: { table: 'phases', start: 'start_date', end: 'end_date', prefix: 'PH' },
  milestone: { table: 'milestones', start: 'target_date', end: 'target_date', prefix: 'MS' },
  release: { table: 'releases', start: 'start_date', end: 'release_date', prefix: 'REL' },
  task: { table: 'tasks', start: 'start_date', end: 'due_date', prefix: 'TASK' },
};

export const refOf = (type, id) => `${ITEM_TYPES[type].prefix}-${id}`;

export async function getItem(type, id) {
  const def = ITEM_TYPES[type];
  return def ? get(`SELECT * FROM ${def.table} WHERE id = ?`, id) : null;
}

/** Planned span; an item with only an end date (or a milestone) is a single day. */
export function spanOf(type, row) {
  const def = ITEM_TYPES[type];
  const end = row[def.end] || null;
  const start = row[def.start] || end;
  return { start, end: end || null };
}

const stateFrom = (status, end, today) => {
  if (status === 'completed') return 'completed';
  if (end && end < today) return 'delayed';
  return status;
};

/** Counts of linked tasks per phase/milestone/release id. */
async function taskStats(column, projectId) {
  const rows = await all(
    `SELECT ${column} AS id, COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'done') AS done,
       COUNT(*) FILTER (WHERE status IN ('in_progress', 'review', 'blocked')) AS active, MAX(completed_at) AS last_done
     FROM tasks WHERE project_id = ? AND ${column} IS NOT NULL GROUP BY ${column}`,
    projectId,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Phases and milestones in "auto" mode take progress and status from their linked tasks;
 * with no linked tasks, or in "manual" mode, the stored values are used.
 */
function resolvePlanItem(item, stats, end, today) {
  const s = stats.get(item.id) || { total: 0, done: 0, active: 0, last_done: null };
  let { progress, status } = item;
  let completedDate = item.completed_date;
  const auto = item.progress_mode === 'auto' && s.total > 0;
  if (auto) {
    progress = Math.round((s.done / s.total) * 100);
    status = progress === 100 ? 'completed' : s.done || s.active ? 'in_progress' : 'not_started';
    completedDate = status === 'completed' ? (s.last_done || '').slice(0, 10) || null : null;
  } else if (status === 'completed') {
    progress = 100;
  }
  return {
    ...item, progress, status, completed_date: completedDate, calculated: auto,
    task_count: s.total, task_done: s.done, state: stateFrom(status, end, today),
  };
}

export function taskProgress(t) {
  if (t.status === 'done') return 100;
  if (t.progress !== null && t.progress !== undefined) return t.progress;
  if (t.subtask_count) return Math.round((t.subtask_done / t.subtask_count) * 100);
  if (t.checklist_total) return Math.round((t.checklist_done / t.checklist_total) * 100);
  return 0;
}

export function taskState(t, today = localDate()) {
  if (t.status === 'done') return 'completed';
  if (t.due_date && t.due_date < today) return 'delayed';
  return t.status === 'todo' ? 'not_started' : 'in_progress';
}

export async function loadPhases(projectId, today = localDate()) {
  const [stats, rows] = await Promise.all([
    taskStats('phase_id', projectId),
    all('SELECT * FROM phases WHERE project_id = ? ORDER BY position, start_date, id', projectId),
  ]);
  return rows.map((p) => ({ ...resolvePlanItem(p, stats, p.end_date, today), ref: refOf('phase', p.id) }));
}

export async function loadMilestones(projectId, today = localDate()) {
  const [stats, rows] = await Promise.all([
    taskStats('milestone_id', projectId),
    all(
      `SELECT m.*, u.name AS owner_name, u.color AS owner_color FROM milestones m LEFT JOIN users u ON u.id = m.owner_id
       WHERE m.project_id = ? ORDER BY m.target_date IS NULL, m.target_date, m.id`,
      projectId,
    ),
  ]);
  return rows.map((m) => ({ ...resolvePlanItem(m, stats, m.target_date, today), ref: refOf('milestone', m.id) }));
}

export async function loadReleases(projectId, today = localDate()) {
  const [stats, bugRows, rows] = await Promise.all([
    taskStats('release_id', projectId),
    all(
      `SELECT release_id AS id, COUNT(*) AS total, COUNT(*) FILTER (WHERE status != 'done') AS open
       FROM tasks WHERE project_id = ? AND release_id IS NOT NULL AND type = 'bug' GROUP BY release_id`,
      projectId,
    ),
    all('SELECT * FROM releases WHERE project_id = ? ORDER BY release_date IS NULL, release_date, id', projectId),
  ]);
  const bugs = new Map(bugRows.map((r) => [r.id, r]));
  return rows.map((r) => {
    const s = stats.get(r.id) || { total: 0, done: 0 };
    const b = bugs.get(r.id) || { total: 0, open: 0 };
    let state;
    if (r.status === 'released') state = 'completed';
    else if (r.status === 'cancelled') state = 'cancelled';
    else state = stateFrom(r.status === 'planned' ? 'not_started' : 'in_progress', r.release_date, today);
    return {
      ...r, ref: refOf('release', r.id), state, task_count: s.total, task_done: s.done,
      progress: r.status === 'released' ? 100 : s.total ? Math.round((s.done / s.total) * 100) : 0,
      bug_count: b.total, open_bugs: b.open,
    };
  });
}

/** Overall progress: share of done tasks, or the weighted average of milestone progress. */
export async function projectProgress(project, milestones) {
  if (project.progress_method === 'milestones') {
    const list = milestones || await loadMilestones(project.id);
    const weight = list.reduce((n, m) => n + (m.weight || 0), 0);
    if (weight > 0) return Math.round(list.reduce((n, m) => n + (m.weight || 0) * m.progress, 0) / weight);
  }
  const t = await get("SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'done') AS done FROM tasks WHERE project_id = ?", project.id);
  return t.total ? Math.round((t.done / t.total) * 100) : 0;
}

export async function loadDependencies(projectId) {
  return (await all('SELECT * FROM dependencies WHERE project_id = ? ORDER BY id', projectId)).map((d) => ({
    ...d, pred_ref: refOf(d.pred_type, d.pred_id), succ_ref: refOf(d.succ_type, d.succ_id),
  }));
}

/** True when adding pred → succ would close a loop (succ already leads to pred). */
export async function createsCycle(predType, predId, succType, succId) {
  const target = `${predType}:${predId}`;
  const seen = new Set();
  const stack = [`${succType}:${succId}`];
  while (stack.length) {
    const key = stack.pop();
    if (key === target) return true;
    if (seen.has(key)) continue;
    seen.add(key);
    const [type, id] = key.split(':');
    for (const d of await all('SELECT succ_type, succ_id FROM dependencies WHERE pred_type = ? AND pred_id = ?', type, Number(id))) {
      stack.push(`${d.succ_type}:${d.succ_id}`);
    }
  }
  return false;
}

async function shiftItem(type, row, days) {
  const def = ITEM_TYPES[type];
  const sets = [];
  const values = [];
  for (const col of new Set([def.start, def.end])) {
    if (row[col]) { sets.push(`${col} = ?`); values.push(addDays(row[col], days)); }
  }
  if (!sets.length) return;
  await run(`UPDATE ${def.table} SET ${sets.join(', ')}${type === 'task' ? ', updated_at = now()' : ''} WHERE id = ?`, ...values, row.id);
}

const itemName = (type, row) => (type === 'task' ? `"${row.title}"` : `${type} "${row.name}"`);

/**
 * Push successors later when an item now ends (FS) or starts (SS) after they start,
 * keeping each successor's duration, and repeat down the chain. Items are never pulled
 * earlier automatically. Returns the refs of items that moved.
 */
export async function reschedule(type, id, userId) {
  const moved = [];
  const queue = [[type, id]];
  let guard = 0;
  while (queue.length && guard++ < 1000) {
    const [pType, pId] = queue.shift();
    const pred = await getItem(pType, pId);
    if (!pred) continue;
    const ps = spanOf(pType, pred);
    for (const d of await all('SELECT * FROM dependencies WHERE pred_type = ? AND pred_id = ?', pType, pId)) {
      const required = d.kind === 'SS' ? ps.start : ps.end;
      const succ = await getItem(d.succ_type, d.succ_id);
      if (!required || !succ) continue;
      const ss = spanOf(d.succ_type, succ);
      if (!ss.start || ss.start >= required) continue;
      const days = daysBetween(ss.start, required);
      await shiftItem(d.succ_type, succ, days);
      moved.push(refOf(d.succ_type, d.succ_id));
      const plural = days === 1 ? '' : 's';
      if (d.succ_type === 'task') {
        await logActivity({ taskId: succ.id, projectId: succ.project_id, userId, action: `rescheduled this task ${days} day${plural} later to follow ${itemName(pType, pred)}` });
      } else {
        await logActivity({ projectId: succ.project_id, userId, action: `moved ${itemName(d.succ_type, succ)} ${days} day${plural} later to follow ${itemName(pType, pred)}` });
      }
      queue.push([d.succ_type, d.succ_id]);
    }
  }
  return moved;
}
