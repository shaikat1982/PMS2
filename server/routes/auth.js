import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { get, run } from '../db.js';
import { publicUser, requireAuth, signToken } from '../auth.js';
import { badRequest, color, setClause, text } from '../util.js';

const router = Router();

router.post('/login', async (req, res) => {
  const email = text(req.body?.email, 'Email', { required: true });
  const password = req.body?.password;
  if (typeof password !== 'string' || !password) throw badRequest('Password is required');
  const user = await get('SELECT * FROM users WHERE lower(email) = lower(?)', email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  if (!user.active) return res.status(403).json({ error: 'This account has been deactivated' });
  res.json({ token: signToken(user), user: publicUser(user) });
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

router.patch('/me', requireAuth, async (req, res) => {
  const b = req.body || {};
  const fields = {
    name: text(b.name, 'Name', { required: b.name !== undefined, max: 100 }),
    title: text(b.title, 'Job title', { max: 100 }),
    color: color(b.color),
  };
  if (b.password !== undefined) {
    if (typeof b.password !== 'string' || b.password.length < 6) throw badRequest('New password must be at least 6 characters');
    const current = await get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!bcrypt.compareSync(String(b.current_password || ''), current.password_hash)) throw badRequest('Current password is incorrect');
    fields.password_hash = bcrypt.hashSync(b.password, 10);
  }
  const { sql, values, keys } = setClause(fields);
  if (keys.length) await run(`UPDATE users SET ${sql} WHERE id = ?`, ...values, req.user.id);
  res.json(publicUser(await get('SELECT * FROM users WHERE id = ?', req.user.id)));
});

export default router;
