import { all, get, insert, run, tx } from '../db.js';
import { isManager } from '../auth.js';
import { notify } from '../notify.js';
import { attachmentsFor } from './attachments.js';
import { gitLinksFor } from './git.js';
import { ITEM_TYPES, getItem, refOf, reschedule } from '../planning.js';
import { getTask, queryTasks } from '../taskQuery.js';
import {
  PRIORITIES, SEVERITIES, STATUSES, TASK_TYPES, badRequest, created, dateOrNull, forbidden, idList, idParam, integer, localDate, logActivity,
  notFound, nowStamp, numberOrNull, oneOf, setClause, text,
} from '../util.js';

const STATUS_LABELS = { todo: 'To Do', in_progress: 'In Progress', review: 'In Review', blocked: 'Blocked', done: 'Done' };
const TYPE_LABELS = { task: 'Task', feature: 'Feature', bug: 'Bug', story: 'User Story' };
const csv = (v) => String(v).split(',').map((s) => s.trim()).filter(Boolean);

function normalizeTags(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw badRequest('tags must be a list');
  return [...new Set(value.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 20).map((t) => t.slice(0, 40));
}

async function userNames(ids) {
  if (!ids.length) return [];
  return (await all('SELECT name FROM users WHERE id = ANY(?::int[]) ORDER BY name', ids)).map((u) => u.name);
}

async function assertUsersExist(ids) {
  if (!ids.length) return;
  const found = new Set((await all('SELECT id FROM users WHERE id = ANY(?::int[])', ids)).map((u) => u.id));
  const missing = ids.find((id) => !found.has(id));
  if (missing) throw badRequest(`User ${missing} does not exist`);
}

async function requireTask(id) {
  const task = await get('SELECT * FROM tasks WHERE id = ?', id);
  if (!task) throw notFound('Task');
  return task;
}

const watchersOf = async (task) => [
  ...(await all('SELECT user_id FROM task_assignees WHERE task_id = ?', task.id)).map((r) => r.user_id), task.created_by,
];

/** Fields shared by create and update. Plan links are checked against the task's project. */
async function readFields(b, projectId) {
  const planLink = async (key, table, label) => {
    if (b[key] === undefined) return undefined;
    if (b[key] === null || b[key] === '') return null;
    const id = idParam(b[key], key);
    if (!await get(`SELECT id FROM ${table} WHERE id = ? AND project_id = ?`, id, projectId)) throw badRequest(`That ${label} is not in this project`);
    return id;
  };
  const long = (key, label) => (b[key] === undefined ? undefined : text(b[key], label, { max: 20000 }) || '');
  return {
    title: text(b.title, 'Title', { required: b.title !== undefined, max: 300 }),
    description: long('description', 'Description'),
    status: oneOf(b.status, STATUSES, 'Status'),
    priority: oneOf(b.priority, PRIORITIES, 'Priority'),
    type: oneOf(b.type, TASK_TYPES, 'Type'),
    start_date: dateOrNull(b.start_date, 'Start date'),
    due_date: dateOrNull(b.due_date, 'Due date'),
    estimate_hours: numberOrNull(b.estimate_hours, 'Estimate'),
    position: numberOrNull(b.position, 'Position', { min: -1e9, max: 1e9 }),
    phase_id: await planLink('phase_id', 'phases', 'phase'),
    milestone_id: await planLink('milestone_id', 'milestones', 'milestone'),
    release_id: await planLink('release_id', 'releases', 'release'),
    is_key: b.is_key === undefined ? undefined : !!b.is_key,
    progress: b.progress === undefined ? undefined : integer(b.progress, 'Progress'),
    severity: b.severity === undefined ? undefined : b.severity ? oneOf(b.severity, SEVERITIES, 'Severity') : null,
    environment: b.environment === undefined ? undefined : text(b.environment, 'Environment', { max: 200 }) || null,
    affected_version: b.affected_version === undefined ? undefined : text(b.affected_version, 'Affected version', { max: 100 }) || null,
    steps_to_reproduce: long('steps_to_reproduce', 'Steps to reproduce'),
    expected_result: long('expected_result', 'Expected result'),
    actual_result: long('actual_result', 'Actual result'),
  };
}

async function dependenciesOf(task) {
  const label = async (type, id) => {
    const item = await getItem(type, id);
    return item ? { ref: refOf(type, id), type, id, name: item.title || item.name, status: item.status } : null;
  };
  const deps = await all("SELECT * FROM dependencies WHERE (pred_type = 'task' AND pred_id = ?) OR (succ_type = 'task' AND succ_id = ?)", task.id, task.id);
  const describe = async (d, type, id) => ({ dependency_id: d.id, kind: d.kind, ...await label(type, id) });
  return {
    blocked_by: await Promise.all(deps.filter((d) => d.succ_type === 'task' && d.succ_id === task.id).map((d) => describe(d, d.pred_type, d.pred_id))),
    blocks: await Promise.all(deps.filter((d) => d.pred_type === 'task' && d.pred_id === task.id).map((d) => describe(d, d.succ_type, d.succ_id))),
  };
}

// ---- List & search -------------------------------------------------------

export async function list({ user, query }) {
  const q = query;
  const where = [];
  const values = [];
  const today = localDate();

  if (q.project_id) { where.push('t.project_id = ?'); values.push(idParam(q.project_id, 'project_id')); }
  if (q.space_id) { where.push('p.space_id = ?'); values.push(idParam(q.space_id, 'space_id')); }
  if (q.parent_id) { where.push('t.parent_id = ?'); values.push(idParam(q.parent_id, 'parent_id')); }
  else if (!q.include_subtasks) where.push('t.parent_id IS NULL');
  for (const key of ['phase_id', 'milestone_id', 'release_id']) {
    if (q[key]) { where.push(`t.${key} = ?`); values.push(idParam(q[key], key)); }
  }
  if (q.assignee) {
    where.push('EXISTS (SELECT 1 FROM task_assignees x WHERE x.task_id = t.id AND x.user_id = ?)');
    values.push(q.assignee === 'me' ? user.id : idParam(q.assignee, 'assignee'));
  }
  for (const [key, allowed] of [['status', STATUSES], ['priority', PRIORITIES], ['type', TASK_TYPES]]) {
    if (!q[key]) continue;
    const list = csv(q[key]).filter((s) => allowed.includes(s));
    if (list.length) { where.push(`t.${key} = ANY(?::text[])`); values.push(list); }
  }
  if (q.open) where.push("t.status != 'done'");
  if (q.due_from) { where.push('t.due_date >= ?'); values.push(dateOrNull(q.due_from, 'due_from')); }
  if (q.due_to) { where.push('t.due_date <= ?'); values.push(dateOrNull(q.due_to, 'due_to')); }
  if (q.overdue) { where.push("t.status != 'done' AND t.due_date < ?"); values.push(today); }
  if (q.tag) { where.push('EXISTS (SELECT 1 FROM task_tags tg WHERE tg.task_id = t.id AND tg.tag = ?)'); values.push(String(q.tag).toLowerCase()); }
  if (q.q) {
    // "TASK-12" or "#12" finds a task by its reference.
    const ref = /^(?:task-?|#)(\d+)$/i.exec(String(q.q).trim());
    if (ref) {
      where.push('t.id = ?');
      values.push(Number(ref[1]));
    } else {
      where.push('(t.title ILIKE ? OR t.description ILIKE ?)');
      const like = `%${String(q.q).replace(/[%_\\]/g, '')}%`;
      values.push(like, like);
    }
  }

  const order = q.sort === 'due'
    ? 't.due_date IS NULL, t.due_date, t.id'
    : q.sort === 'updated' ? 't.updated_at DESC' : 't.position, t.id';
  const limit = Math.min(Number(q.limit) || 2000, 2000);
  return queryTasks({ where, params: values, order, limit });
}

export async function tags() {
  return await all('SELECT tag, COUNT(*) AS count FROM task_tags GROUP BY tag ORDER BY count DESC, tag LIMIT 200');
}

export async function show({ params }) {
  const id = idParam(params.id);
  const task = await getTask(id);
  if (!task) throw notFound('Task');
  const [subtasks, checklist, comments, activity, timeEntries, attachments, git, dependencies] = await Promise.all([
    queryTasks({ where: ['t.parent_id = ?'], params: [id] }),
    all('SELECT * FROM checklist_items WHERE task_id = ? ORDER BY position, id', id),
    all(
      `SELECT c.*, u.name AS user_name, u.color AS user_color FROM comments c LEFT JOIN users u ON u.id = c.user_id
       WHERE c.task_id = ? ORDER BY c.id`, id,
    ),
    all(
      `SELECT a.*, u.name AS user_name, u.color AS user_color FROM activity a LEFT JOIN users u ON u.id = a.user_id
       WHERE a.task_id = ? ORDER BY a.id`, id,
    ),
    all(
      `SELECT te.*, u.name AS user_name, u.color AS user_color FROM time_entries te LEFT JOIN users u ON u.id = te.user_id
       WHERE te.task_id = ? ORDER BY te.date DESC, te.id DESC`, id,
    ),
    attachmentsFor(id),
    gitLinksFor(id),
    dependenciesOf(task),
  ]);
  return {
    ...task, ref: refOf('task', id), subtasks, checklist, comments, activity, time_entries: timeEntries, attachments, git, dependencies,
  };
}

// ---- Create / update / delete -------------------------------------------

export async function create({ user, body }) {
  const b = body;
  let projectId = b.project_id ? idParam(b.project_id, 'project_id') : null;
  let parentId = null;
  if (b.parent_id) {
    const parent = await requireTask(idParam(b.parent_id, 'parent_id'));
    parentId = parent.id;
    projectId = parent.project_id;
  }
  if (!projectId) throw badRequest('Choose a project for this task');
  const project = await get('SELECT id, name FROM projects WHERE id = ?', projectId);
  if (!project) throw badRequest('Project does not exist');

  const f = await readFields({ ...b, title: b.title ?? '' }, projectId);
  f.status ||= 'todo';
  f.priority ||= 'normal';
  f.type ||= 'task';
  if (f.description === undefined) f.description = '';
  if (f.status === 'done') f.completed_at = nowStamp();
  const assigneeIds = idList(b.assignee_ids, 'assignee_ids') || [];
  await assertUsersExist(assigneeIds);
  const tags = normalizeTags(b.tags) || [];

  const id = await tx(async () => {
    const position = (await get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM tasks WHERE project_id = ?', projectId)).p;
    const { keys, values } = setClause({ ...f, position: f.position ?? position });
    const taskId = await insert(
      `INSERT INTO tasks (project_id, parent_id, created_by, ${keys.join(', ')}) VALUES (?, ?, ?, ${keys.map(() => '?').join(', ')})`,
      projectId, parentId, user.id, ...values,
    );
    for (const uid of assigneeIds) await run('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)', taskId, uid);
    for (const tag of tags) await run('INSERT INTO task_tags (task_id, tag) VALUES (?, ?)', taskId, tag);
    const noun = parentId ? 'subtask' : f.type === 'task' ? 'task' : TYPE_LABELS[f.type].toLowerCase();
    await logActivity({ taskId, projectId, userId: user.id, action: `created this ${noun}` });
    await notify(assigneeIds, user.id, taskId, `${user.name} assigned you to "${f.title}"`, 'assigned');
    return taskId;
  });
  return created(await getTask(id));
}

export async function update({ user, params, body }) {
  const id = idParam(params.id);
  const before = await requireTask(id);
  const b = body;
  const me = user;

  let newProject = null;
  if (b.project_id !== undefined && Number(b.project_id) !== before.project_id) {
    if (before.parent_id) throw badRequest('Subtasks follow their parent task; move the parent instead');
    newProject = await get('SELECT id, name FROM projects WHERE id = ?', idParam(b.project_id, 'project_id'));
    if (!newProject) throw badRequest('Project does not exist');
  }
  const fields = await readFields(b, newProject ? newProject.id : before.project_id);
  if (newProject) {
    fields.project_id = newProject.id;
    // Phases, milestones and releases belong to the old project.
    for (const k of ['phase_id', 'milestone_id', 'release_id']) if (fields[k] === undefined) fields[k] = null;
  }
  const assigneeIds = idList(b.assignee_ids, 'assignee_ids');
  if (assigneeIds) await assertUsersExist(assigneeIds);
  const tags = normalizeTags(b.tags);

  const rescheduled = await tx(async () => {
    const log = (action) => logActivity({ taskId: id, projectId: fields.project_id || before.project_id, userId: me.id, action });
    const title = fields.title || before.title;
    const changed = (k) => fields[k] !== undefined && fields[k] !== before[k];
    const watchers = await watchersOf(before);

    if (changed('status')) {
      fields.completed_at = fields.status === 'done' ? nowStamp() : null;
      await log(`changed status from ${STATUS_LABELS[before.status]} to ${STATUS_LABELS[fields.status]}`);
      await notify(watchers, me.id, id, `${me.name} moved "${title}" to ${STATUS_LABELS[fields.status]}`, 'status');
    }
    if (changed('priority')) {
      await log(`set priority to ${fields.priority}`);
      await notify(watchers, me.id, id, `${me.name} set the priority of "${title}" to ${fields.priority}`, 'priority');
    }
    if (changed('type')) await log(`changed the type to ${TYPE_LABELS[fields.type]}`);
    if (changed('due_date')) {
      await log(fields.due_date ? `set due date to ${fields.due_date}` : 'removed the due date');
      await notify(watchers, me.id, id, fields.due_date ? `${me.name} changed the due date of "${title}" to ${fields.due_date}` : `${me.name} removed the due date of "${title}"`, 'due_date');
    }
    if (changed('start_date')) await log(fields.start_date ? `set start date to ${fields.start_date}` : 'removed the start date');
    if (fields.title && fields.title !== before.title) await log(`renamed the task from "${before.title}"`);
    if (changed('description')) await log('updated the description');
    if (changed('estimate_hours')) await log(fields.estimate_hours ? `set estimate to ${fields.estimate_hours}h` : 'removed the estimate');
    if (changed('progress')) await log(fields.progress === null ? 'set progress to be calculated automatically' : `set progress to ${fields.progress}%`);
    if (changed('is_key')) await log(fields.is_key ? 'marked this as a key task' : 'unmarked this as a key task');
    if (changed('severity')) await log(fields.severity ? `set severity to ${fields.severity}` : 'cleared the severity');
    for (const [key, table, label] of [['phase_id', 'phases', 'phase'], ['milestone_id', 'milestones', 'milestone'], ['release_id', 'releases', 'release']]) {
      if (!changed(key) || newProject) continue;
      const row = fields[key] ? await get(`SELECT name FROM ${table} WHERE id = ?`, fields[key]) : null;
      await log(row ? `added this to ${label} "${row.name}"` : `removed this from its ${label}`);
    }
    if (newProject) {
      await log(`moved the task to ${newProject.name}`);
      await run(
        `WITH RECURSIVE sub(id) AS (SELECT id FROM tasks WHERE parent_id = ? UNION ALL SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id)
         UPDATE tasks SET project_id = ?, phase_id = NULL, milestone_id = NULL, release_id = NULL WHERE id IN (SELECT id FROM sub)`, id, newProject.id,
      );
      // Dependencies only make sense inside one project.
      await run("DELETE FROM dependencies WHERE (pred_type = 'task' AND pred_id = ?) OR (succ_type = 'task' AND succ_id = ?)", id, id);
    }

    const { sql, values, keys } = setClause(fields);
    if (keys.length) await run(`UPDATE tasks SET ${sql}, updated_at = now() WHERE id = ?`, ...values, id);

    if (assigneeIds) {
      const current = (await all('SELECT user_id FROM task_assignees WHERE task_id = ?', id)).map((r) => r.user_id);
      const added = assigneeIds.filter((u) => !current.includes(u));
      const removed = current.filter((u) => !assigneeIds.includes(u));
      for (const u of removed) await run('DELETE FROM task_assignees WHERE task_id = ? AND user_id = ?', id, u);
      for (const u of added) await run('INSERT INTO task_assignees (task_id, user_id) VALUES (?, ?)', id, u);
      if (added.length) await log(`assigned ${(await userNames(added)).join(', ')}`);
      if (removed.length) await log(`unassigned ${(await userNames(removed)).join(', ')}`);
      await notify(added, me.id, id, `${me.name} assigned you to "${title}"`, 'assigned');
      if (added.length || removed.length) await run('UPDATE tasks SET updated_at = now() WHERE id = ?', id);
    }
    if (tags) {
      await run('DELETE FROM task_tags WHERE task_id = ?', id);
      for (const tag of tags) await run('INSERT INTO task_tags (task_id, tag) VALUES (?, ?)', id, tag);
    }
    const { start, end } = ITEM_TYPES.task;
    return changed(start) || changed(end) ? reschedule('task', id, me.id) : [];
  });
  return { ...await getTask(id), rescheduled };
}

export async function remove({ user, params }) {
  const task = await requireTask(idParam(params.id));
  if (!isManager(user) && task.created_by !== user.id) throw forbidden();
  await tx(async () => {
    await run('DELETE FROM tasks WHERE id = ?', task.id);
    await logActivity({ projectId: task.project_id, userId: user.id, action: `deleted task "${task.title}"` });
  });
  return;
}

// ---- Comments ------------------------------------------------------------

export async function addComment({ user, params, body }) {
  const task = await requireTask(idParam(params.id));
  const comment = text(body.body, 'Comment', { required: true, max: 10000 });
  const commentId = await tx(async () => {
    const newId = await insert('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)', task.id, user.id, comment);
    // Anyone mentioned as @Firstname or @"Full Name" gets a mention; other watchers get a comment notification.
    const lower = comment.toLowerCase();
    const mentioned = (await all('SELECT id, name FROM users WHERE active')).filter((u) => (
      lower.includes(`@${u.name.toLowerCase()}`) || lower.includes(`@${u.name.split(' ')[0].toLowerCase()}`)
    )).map((u) => u.id);
    await notify(mentioned, user.id, task.id, `${user.name} mentioned you on "${task.title}"`, 'mentioned', { quote: comment });
    await notify((await watchersOf(task)).filter((u) => !mentioned.includes(u)), user.id, task.id, `${user.name} commented on "${task.title}"`, 'commented', { quote: comment });
    await run('UPDATE tasks SET updated_at = now() WHERE id = ?', task.id);
    return newId;
  });
  return created(await get(
    'SELECT c.*, u.name AS user_name, u.color AS user_color FROM comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.id = ?',
    commentId,
  ));
}

export async function removeComment({ user, params }) {
  const comment = await get('SELECT * FROM comments WHERE id = ?', idParam(params.cid));
  if (!comment) throw notFound('Comment');
  if (comment.user_id !== user.id && user.role !== 'admin') throw forbidden();
  await run('DELETE FROM comments WHERE id = ?', comment.id);
  return;
}

// ---- Checklist -----------------------------------------------------------

export async function addChecklistItem({ params, body }) {
  const task = await requireTask(idParam(params.id));
  const itemText = text(body.text, 'Checklist item', { required: true, max: 500 });
  const position = (await get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM checklist_items WHERE task_id = ?', task.id)).p;
  const id = await insert('INSERT INTO checklist_items (task_id, text, position) VALUES (?, ?, ?)', task.id, itemText, position);
  return created(await get('SELECT * FROM checklist_items WHERE id = ?', id));
}

export async function updateChecklistItem({ params, body }) {
  const id = idParam(params.cid);
  const item = await get('SELECT * FROM checklist_items WHERE id = ?', id);
  if (!item) throw notFound('Checklist item');
  const { sql, values, keys } = setClause({
    text: text(body.text, 'Checklist item', { required: body.text !== undefined, max: 500 }),
    done: body.done === undefined ? undefined : !!body.done,
  });
  if (keys.length) await run(`UPDATE checklist_items SET ${sql} WHERE id = ?`, ...values, id);
  return await get('SELECT * FROM checklist_items WHERE id = ?', id);
}

export async function removeChecklistItem({ params }) {
  const { changes } = await run('DELETE FROM checklist_items WHERE id = ?', idParam(params.cid));
  if (!changes) throw notFound('Checklist item');
  return;
}

// ---- Time tracking -------------------------------------------------------

export async function logTime({ user, params, body }) {
  const task = await requireTask(idParam(params.id));
  const hours = numberOrNull(body.hours, 'Hours', { min: 0.05, max: 24 });
  if (!hours) throw badRequest('Hours is required');
  const date = dateOrNull(body.date, 'Date') || localDate();
  const id = await tx(async () => {
    const newId = await insert(
      'INSERT INTO time_entries (task_id, user_id, hours, note, date) VALUES (?, ?, ?, ?, ?)',
      task.id, user.id, hours, text(body.note, 'Note', { max: 500 }), date,
    );
    await logActivity({ taskId: task.id, projectId: task.project_id, userId: user.id, action: `logged ${hours}h` });
    return newId;
  });
  return created(await get('SELECT * FROM time_entries WHERE id = ?', id));
}

export async function removeTime({ user, params }) {
  const entry = await get('SELECT * FROM time_entries WHERE id = ?', idParam(params.eid));
  if (!entry) throw notFound('Time entry');
  if (entry.user_id !== user.id && !isManager(user)) throw forbidden();
  await run('DELETE FROM time_entries WHERE id = ?', entry.id);
  return;
}

