import { Router } from 'express';
import { all, get, insert, run } from '../db.js';
import { requireRole } from '../auth.js';
import { color, idParam, notFound, setClause, text } from '../util.js';

const router = Router();

const SPACE_SELECT = `
SELECT s.*,
  (SELECT COUNT(*) FROM projects p WHERE p.space_id = s.id) AS project_count,
  (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.space_id = s.id) AS task_count,
  (SELECT COUNT(*) FROM tasks t JOIN projects p ON p.id = t.project_id WHERE p.space_id = s.id AND t.status = 'done') AS done_count
FROM spaces s`;

router.get('/', async (req, res) => res.json(await all(`${SPACE_SELECT} ORDER BY s.position, s.id`)));

router.post('/', requireRole('admin', 'manager'), async (req, res) => {
  const b = req.body || {};
  const position = (await get('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM spaces')).p;
  const id = await insert(
    'INSERT INTO spaces (name, description, color, position) VALUES (?, ?, ?, ?)',
    text(b.name, 'Name', { required: true, max: 100 }), text(b.description, 'Description', { max: 1000 }), color(b.color) || '#7b68ee', position,
  );
  res.status(201).json(await get(`${SPACE_SELECT} WHERE s.id = ?`, id));
});

router.patch('/:id', requireRole('admin', 'manager'), async (req, res) => {
  const id = idParam(req.params.id);
  if (!await get('SELECT id FROM spaces WHERE id = ?', id)) throw notFound('Space');
  const b = req.body || {};
  const { sql, values, keys } = setClause({
    name: text(b.name, 'Name', { required: b.name !== undefined, max: 100 }),
    description: text(b.description, 'Description', { max: 1000 }),
    color: color(b.color),
  });
  if (keys.length) await run(`UPDATE spaces SET ${sql} WHERE id = ?`, ...values, id);
  res.json(await get(`${SPACE_SELECT} WHERE s.id = ?`, id));
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  const { changes } = await run('DELETE FROM spaces WHERE id = ?', idParam(req.params.id));
  if (!changes) throw notFound('Space');
  res.status(204).end();
});

export default router;
