import { all, get, insert, run } from '../db.js';
import { requireRole } from '../auth.js';
import { color, created, idParam, notFound, setClause, text } from '../util.js';

const SPACE_SELECT = `
SELECT s.*,
  (SELECT COUNT(*) FROM projects p WHERE p.space_id = s.id) AS project_count,
  (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.space_id = s.id) AS task_count,
  (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.space_id = s.id AND t.status = 'done') AS done_count
FROM spaces s`;

export const list = () => all(`${SPACE_SELECT} ORDER BY s.position, s.id`);

export async function create({ user, body: b }) {
  requireRole(user, 'admin', 'manager');
  const position = (await get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM spaces')).p;
  const id = await insert(
    'INSERT INTO spaces (name, description, color, position) VALUES (?, ?, ?, ?)',
    text(b.name, 'Name', { required: true, max: 100 }), text(b.description, 'Description', { max: 1000 }), color(b.color) || '#7b68ee', position,
  );
  return created(await get(`${SPACE_SELECT} WHERE s.id = ?`, id));
}

export async function update({ user, params, body: b }) {
  requireRole(user, 'admin', 'manager');
  const id = idParam(params.id);
  if (!await get('SELECT id FROM spaces WHERE id = ?', id)) throw notFound('Space');
  const { sql, values, keys } = setClause({
    name: text(b.name, 'Name', { required: b.name !== undefined, max: 100 }),
    description: text(b.description, 'Description', { max: 1000 }),
    color: color(b.color),
  });
  if (keys.length) await run(`UPDATE spaces SET ${sql} WHERE id = ?`, ...values, id);
  return get(`${SPACE_SELECT} WHERE s.id = ?`, id);
}

export async function remove({ user, params }) {
  requireRole(user, 'admin');
  const { changes } = await run('DELETE FROM spaces WHERE id = ?', idParam(params.id));
  if (!changes) throw notFound('Space');
}
