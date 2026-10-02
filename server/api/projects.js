import { all, get, insert, run, tx } from '../db.js';
import { canManageProject, requireRole } from '../auth.js';
import {
  loadDependencies, loadMilestones, loadPhases, loadReleases, projectProgress, refOf, taskProgress, taskState,
} from '../planning.js';
import { projectReports } from '../reports.js';
import { queryTasks } from '../taskQuery.js';
import {
  PROGRESS_METHODS, PROJECT_STATUSES, PROJECT_TYPES, addDays, badRequest, created, color, dateOrNull, daysBetween, idParam, localDate,
  logActivity, notFound, oneOf, setClause, text,
} from '../util.js';

const PROJECT_SELECT = `
SELECT p.*, s.name AS space_name, s.color AS space_color, u.name AS owner_name, u.color AS owner_color,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'done' AND t.due_date < ?) AS overdue_count
FROM projects p
JOIN spaces s ON s.id = p.space_id
LEFT JOIN users u ON u.id = p.owner_id`;

const withProgress = async (p) => (p ? { ...p, progress: await projectProgress(p) } : p);
const findProject = async (id) => withProgress(await get(`${PROJECT_SELECT} WHERE p.id = ?`, localDate(), id));

// Software projects start with these phases, chained finish-to-start. When the project
// has both dates, they're spread across it in these proportions.
const DEFAULT_PHASES = [
  ['Planning', '#8b5cf6', 0.15],
  ['Development', '#3b82f6', 0.45],
  ['Testing', '#f59e0b', 0.2],
  ['Deployment', '#10b981', 0.1],
  ['Maintenance', '#64748b', 0.1],
];

async function createDefaultPhases(project) {
  const span = project.start_date && project.due_date && project.due_date > project.start_date
    ? daysBetween(project.start_date, project.due_date) : null;
  let cursor = project.start_date;
  let prevId = null;
  for (const [i, [name, phaseColor, share]] of DEFAULT_PHASES.entries()) {
    let start = null;
    let end = null;
    if (span) {
      start = cursor;
      end = i === DEFAULT_PHASES.length - 1 ? project.due_date : addDays(start, Math.max(1, Math.round(span * share)));
      if (end > project.due_date) end = project.due_date;
      cursor = end;
    }
    const id = await insert(
      'INSERT INTO phases (project_id, name, color, start_date, end_date, position) VALUES (?, ?, ?, ?, ?, ?)',
      project.id, name, phaseColor, start, end, i + 1,
    );
    if (prevId) await run("INSERT INTO dependencies (project_id, pred_type, pred_id, succ_type, succ_id) VALUES (?, 'phase', ?, 'phase', ?)", project.id, prevId, id);
    prevId = id;
  }
}

async function fieldsFrom(b) {
  const ownerId = b.owner_id === undefined ? undefined : b.owner_id === null || b.owner_id === '' ? null : idParam(b.owner_id, 'owner_id');
  if (ownerId && !await get('SELECT id FROM users WHERE id = ?', ownerId)) throw badRequest('Owner does not exist');
  return {
    name: text(b.name, 'Name', { required: b.name !== undefined, max: 150 }),
    description: text(b.description, 'Description', { max: 5000 }),
    color: color(b.color),
    status: oneOf(b.status, PROJECT_STATUSES, 'Status'),
    owner_id: ownerId,
    start_date: dateOrNull(b.start_date, 'Start date'),
    due_date: dateOrNull(b.due_date, 'Due date'),
    type: oneOf(b.type, PROJECT_TYPES, 'Project type'),
    progress_method: oneOf(b.progress_method, PROGRESS_METHODS, 'Progress method'),
  };
}

export async function list({ query }) {
  const where = [];
  const values = [localDate()];
  if (query.space_id) {
    where.push('p.space_id = ?');
    values.push(idParam(query.space_id, 'space_id'));
  }
  const rows = await all(`${PROJECT_SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY p.space_id, p.name`, ...values);
  return await Promise.all(rows.map(withProgress));
}

export async function show({ params }) {
  const project = await findProject(idParam(params.id));
  if (!project) throw notFound('Project');
  return project;
}

/** Everything the Overview, Timeline and Planning tabs need, in one request. */
export async function plan({ user, params }) {
  const project = await findProject(idParam(params.id));
  if (!project) throw notFound('Project');
  const today = localDate();
  const [milestones, phases, releases, taskRows, dependencies] = await Promise.all([
    loadMilestones(project.id, today),
    loadPhases(project.id, today),
    loadReleases(project.id, today),
    queryTasks({ where: ['t.project_id = ?', 't.parent_id IS NULL'], params: [project.id] }),
    loadDependencies(project.id),
  ]);
  return {
    project: { ...project, progress: await projectProgress(project, milestones) },
    can_manage: canManageProject(user, project),
    today,
    phases,
    milestones,
    releases,
    tasks: taskRows.map((t) => ({ ...t, ref: refOf('task', t.id), progress: taskProgress(t), state: taskState(t, today) })),
    dependencies,
  };
}

export async function reports({ params }) {
  const project = await findProject(idParam(params.id));
  if (!project) throw notFound('Project');
  return await projectReports(project);
}

export async function create({ user, body }) {
  requireRole(user, 'admin', 'manager');
  const b = body;
  const spaceId = idParam(b.space_id, 'space_id');
  if (!await get('SELECT id FROM spaces WHERE id = ?', spaceId)) throw badRequest('Space does not exist');
  const f = await fieldsFrom({ ...b, name: b.name ?? '' });
  if (f.start_date && f.due_date && f.start_date > f.due_date) throw badRequest('The start date must be on or before the due date');
  const id = await tx(async () => {
    const projectId = await insert(
      `INSERT INTO projects (space_id, name, description, color, status, owner_id, start_date, due_date, type, progress_method)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      spaceId, f.name, f.description, f.color || '#7b68ee', f.status || 'active', f.owner_id ?? user.id, f.start_date, f.due_date,
      f.type || 'general', f.progress_method || 'tasks',
    );
    if (f.type === 'software' && b.default_phases !== false) await createDefaultPhases(await get('SELECT * FROM projects WHERE id = ?', projectId));
    await logActivity({ projectId, userId: user.id, action: `created project "${f.name}"` });
    return projectId;
  });
  return created(await findProject(id));
}

export async function update({ user, params, body }) {
  requireRole(user, 'admin', 'manager');
  const id = idParam(params.id);
  const before = await get('SELECT * FROM projects WHERE id = ?', id);
  if (!before) throw notFound('Project');
  const b = body;
  const fields = await fieldsFrom(b);
  if (b.space_id !== undefined) {
    fields.space_id = idParam(b.space_id, 'space_id');
    if (!await get('SELECT id FROM spaces WHERE id = ?', fields.space_id)) throw badRequest('Space does not exist');
  }
  await tx(async () => {
    const { sql, values, keys } = setClause(fields);
    if (keys.length) await run(`UPDATE projects SET ${sql} WHERE id = ?`, ...values, id);
    // Switching a project to Software Development gives it the standard phases if it has none yet.
    if (fields.type === 'software' && before.type !== 'software' && !await get('SELECT id FROM phases WHERE project_id = ?', id)) {
      await createDefaultPhases(await get('SELECT * FROM projects WHERE id = ?', id));
    }
  });
  return await findProject(id);
}

export async function remove({ user, params }) {
  requireRole(user, 'admin', 'manager');
  const { changes } = await run('DELETE FROM projects WHERE id = ?', idParam(params.id));
  if (!changes) throw notFound('Project');
  return;
}

