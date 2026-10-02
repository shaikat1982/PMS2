import { get, insert, run, tx } from '../db.js';
import { canManageProject } from '../auth.js';
import { ITEM_TYPES, createsCycle, getItem, loadMilestones, loadPhases, loadReleases, refOf, reschedule } from '../planning.js';
import {
  PLAN_STATUSES, PROGRESS_MODES, RELEASE_STATUSES, badRequest, color, created, dateOrNull, forbidden, idParam, integer, logActivity,
  notFound, numberOrNull, oneOf, setClause, text,
} from '../util.js';

async function projectFor(projectId, user) {
  const project = await get('SELECT * FROM projects WHERE id = ?', projectId);
  if (!project) throw badRequest('Project does not exist');
  if (!canManageProject(user, project)) throw forbidden();
  return project;
}

function checkRange(start, end) {
  if (start && end && start > end) throw badRequest('The start date must be on or before the end date');
}

/** Status "completed" stamps a completion date; any other status clears it. */
function completion(fields, before) {
  if (fields.status === undefined || fields.status === before?.status) return;
  if (fields.status === 'completed') {
    if (fields.completed_date === undefined) fields.completed_date = new Date().toISOString().slice(0, 10);
    if (fields.progress === undefined) fields.progress = 100;
  } else if (fields.completed_date === undefined) {
    fields.completed_date = null;
  }
}

/**
 * Create/update/delete handlers shared by phases, milestones and releases. Each entity
 * defines which fields it accepts; date changes push dependent items later through reschedule().
 */
function crud(type, { fields: readFields, defaults = {}, load, label }) {
  const { table } = ITEM_TYPES[type];
  const Label = label[0].toUpperCase() + label.slice(1);
  const fetch = async (id) => {
    const row = await get(`SELECT project_id FROM ${table} WHERE id = ?`, id);
    return row ? (await load(row.project_id)).find((x) => x.id === id) : null;
  };

  async function create({ user, body: b }) {
    const project = await projectFor(idParam(b.project_id, 'project_id'), user);
    const f = await readFields(b, project, null);
    for (const [k, v] of Object.entries(defaults)) if (f[k] === undefined) f[k] = typeof v === 'function' ? await v(project) : v;
    if (!f.name) throw badRequest('Name is required');
    completion(f, null);
    const id = await tx(async () => {
      const { keys, values } = setClause(f);
      const newId = await insert(
        `INSERT INTO ${table} (project_id, ${keys.join(', ')}) VALUES (?, ${keys.map(() => '?').join(', ')})`, project.id, ...values,
      );
      await logActivity({ projectId: project.id, userId: user.id, action: `added ${label} "${f.name}"` });
      return newId;
    });
    return created(await fetch(id));
  }

  async function update({ user, params, body }) {
    const id = idParam(params.id);
    const before = await getItem(type, id);
    if (!before) throw notFound(Label);
    const project = await projectFor(before.project_id, user);
    const f = await readFields(body, project, before);
    if (f.name === null || f.name === '') throw badRequest('Name is required');
    completion(f, before);
    const moved = await tx(async () => {
      const { sql, values, keys } = setClause(f);
      if (!keys.length) return [];
      await run(`UPDATE ${table} SET ${sql} WHERE id = ?`, ...values, id);
      const def = ITEM_TYPES[type];
      if (f.status && f.status !== before.status) {
        await logActivity({ projectId: project.id, userId: user.id, action: `marked ${label} "${f.name || before.name}" as ${f.status.replace('_', ' ')}` });
      }
      const datesChanged = [def.start, def.end].some((c) => f[c] !== undefined && f[c] !== before[c]);
      return datesChanged ? reschedule(type, id, user.id) : [];
    });
    return { ...await fetch(id), rescheduled: moved };
  }

  async function remove({ user, params }) {
    const id = idParam(params.id);
    const item = await getItem(type, id);
    if (!item) throw notFound(Label);
    await projectFor(item.project_id, user);
    await tx(async () => {
      await run(`DELETE FROM ${table} WHERE id = ?`, id);
      await logActivity({ projectId: item.project_id, userId: user.id, action: `deleted ${label} "${item.name}"` });
    });
  }

  return { create, update, remove };
}

const common = (b) => ({
  name: text(b.name, 'Name', { required: b.name !== undefined, max: 150 }),
  description: b.description === undefined ? undefined : text(b.description, 'Description', { max: 5000 }) || '',
});

export const phases = crud('phase', {
  label: 'phase',
  load: loadPhases,
  defaults: {
    position: async (project) => (await get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM phases WHERE project_id = ?', project.id)).p,
  },
  fields: (b, project, before) => {
    const f = {
      ...common(b),
      color: color(b.color),
      start_date: dateOrNull(b.start_date, 'Start date'),
      end_date: dateOrNull(b.end_date, 'End date'),
      status: oneOf(b.status, PLAN_STATUSES, 'Status'),
      progress_mode: oneOf(b.progress_mode, PROGRESS_MODES, 'Progress mode'),
      progress: integer(b.progress, 'Progress'),
      completed_date: dateOrNull(b.completed_date, 'Completion date'),
      position: integer(b.position, 'Position', { min: 0, max: 10000 }),
    };
    checkRange(f.start_date !== undefined ? f.start_date : before?.start_date, f.end_date !== undefined ? f.end_date : before?.end_date);
    return f;
  },
});

export const milestones = crud('milestone', {
  label: 'milestone',
  load: loadMilestones,
  fields: async (b, project) => {
    const phaseId = b.phase_id === undefined ? undefined : b.phase_id ? idParam(b.phase_id, 'phase_id') : null;
    if (phaseId && !await get('SELECT id FROM phases WHERE id = ? AND project_id = ?', phaseId, project.id)) throw badRequest('That phase is not in this project');
    const ownerId = b.owner_id === undefined ? undefined : b.owner_id ? idParam(b.owner_id, 'owner_id') : null;
    if (ownerId && !await get('SELECT id FROM users WHERE id = ?', ownerId)) throw badRequest('Owner does not exist');
    return {
      ...common(b),
      phase_id: phaseId,
      owner_id: ownerId,
      target_date: dateOrNull(b.target_date, 'Target date'),
      completed_date: dateOrNull(b.completed_date, 'Completion date'),
      status: oneOf(b.status, PLAN_STATUSES, 'Status'),
      progress_mode: oneOf(b.progress_mode, PROGRESS_MODES, 'Progress mode'),
      progress: integer(b.progress, 'Progress'),
      weight: numberOrNull(b.weight, 'Weight', { min: 0, max: 1000 }) ?? undefined,
    };
  },
});

export const releases = crud('release', {
  label: 'release',
  load: loadReleases,
  fields: (b, project, before) => {
    const f = {
      ...common(b),
      status: oneOf(b.status, RELEASE_STATUSES, 'Status'),
      start_date: dateOrNull(b.start_date, 'Start date'),
      release_date: dateOrNull(b.release_date, 'Release date'),
      released_date: dateOrNull(b.released_date, 'Actual release date'),
    };
    checkRange(f.start_date !== undefined ? f.start_date : before?.start_date, f.release_date !== undefined ? f.release_date : before?.release_date);
    if (f.status === 'released' && before?.status !== 'released' && f.released_date === undefined) f.released_date = new Date().toISOString().slice(0, 10);
    if (f.status && f.status !== 'released' && f.released_date === undefined && before?.status === 'released') f.released_date = null;
    return f;
  },
});

// ---- Dependencies --------------------------------------------------------

/** Parse "PH-3" / "MS-5" / "REL-2" / "TASK-12" into a timeline item. */
async function parseRef(value) {
  const m = /^(PH|MS|REL|TASK)-(\d+)$/i.exec(String(value || '').trim());
  if (!m) throw badRequest(`"${value}" is not a phase, milestone, release or task reference`);
  const type = Object.keys(ITEM_TYPES).find((k) => ITEM_TYPES[k].prefix === m[1].toUpperCase());
  const item = await getItem(type, Number(m[2]));
  if (!item) throw badRequest(`${value} does not exist`);
  return { type, item };
}

export async function addDependency({ user, body: b }) {
  const pred = await parseRef(b.predecessor);
  const succ = await parseRef(b.successor);
  const kind = oneOf(b.kind ?? 'FS', ['FS', 'SS'], 'Dependency type');
  if (pred.item.project_id !== succ.item.project_id) throw badRequest('Both items must be in the same project');
  if (pred.type === succ.type && pred.item.id === succ.item.id) throw badRequest('An item cannot depend on itself');
  const project = await get('SELECT * FROM projects WHERE id = ?', pred.item.project_id);
  // Anyone can link two tasks; changing the plan itself needs a manager or the project owner.
  if ((pred.type !== 'task' || succ.type !== 'task') && !canManageProject(user, project)) throw forbidden();

  const moved = await tx(async () => {
    if (await createsCycle(pred.type, pred.item.id, succ.type, succ.item.id)) throw badRequest('That would create a circular dependency');
    const { changes } = await run(
      'INSERT INTO dependencies (project_id, pred_type, pred_id, succ_type, succ_id, kind) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
      project.id, pred.type, pred.item.id, succ.type, succ.item.id, kind,
    );
    if (!changes) throw badRequest('That dependency already exists');
    const name = (x) => x.item.title || x.item.name;
    if (succ.type === 'task') {
      await logActivity({ taskId: succ.item.id, projectId: project.id, userId: user.id, action: `added dependency on "${name(pred)}" (${refOf(pred.type, pred.item.id)})` });
    } else {
      await logActivity({ projectId: project.id, userId: user.id, action: `made "${name(succ)}" depend on "${name(pred)}"` });
    }
    return reschedule(pred.type, pred.item.id, user.id);
  });
  return created({ ok: true, rescheduled: moved });
}

export async function removeDependency({ user, params }) {
  const dep = await get('SELECT * FROM dependencies WHERE id = ?', idParam(params.id));
  if (!dep) throw notFound('Dependency');
  const project = await get('SELECT * FROM projects WHERE id = ?', dep.project_id);
  if ((dep.pred_type !== 'task' || dep.succ_type !== 'task') && !canManageProject(user, project)) throw forbidden();
  await run('DELETE FROM dependencies WHERE id = ?', dep.id);
}
