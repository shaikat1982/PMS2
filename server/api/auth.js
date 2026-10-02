import bcrypt from 'bcryptjs';
import { get, run } from '../db.js';
import { publicUser, signToken } from '../auth.js';
import { HttpError, badRequest, color, setClause, text } from '../util.js';

export async function login({ body }) {
  const email = text(body.email, 'Email', { required: true });
  const password = body.password;
  if (typeof password !== 'string' || !password) throw badRequest('Password is required');
  const user = await get('SELECT * FROM users WHERE lower(email) = lower(?)', email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) throw new HttpError(401, 'Incorrect email or password');
  if (!user.active) throw new HttpError(403, 'This account has been deactivated');
  return { token: signToken(user), user: publicUser(user) };
}

export const me = ({ user }) => user;

export async function updateMe({ user, body: b }) {
  const fields = {
    name: text(b.name, 'Name', { required: b.name !== undefined, max: 100 }),
    title: text(b.title, 'Job title', { max: 100 }),
    color: color(b.color),
  };
  if (b.password !== undefined) {
    if (typeof b.password !== 'string' || b.password.length < 6) throw badRequest('New password must be at least 6 characters');
    const current = await get('SELECT password_hash FROM users WHERE id = ?', user.id);
    if (!bcrypt.compareSync(String(b.current_password || ''), current.password_hash)) throw badRequest('Current password is incorrect');
    fields.password_hash = bcrypt.hashSync(b.password, 10);
  }
  const { sql, values, keys } = setClause(fields);
  if (keys.length) await run(`UPDATE users SET ${sql} WHERE id = ?`, ...values, user.id);
  return publicUser(await get('SELECT * FROM users WHERE id = ?', user.id));
}
