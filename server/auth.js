import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { DATA_DIR, get } from './db.js';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const SECRET = loadSecret();

export const signToken = (user) => jwt.sign({ sub: String(user.id) }, SECRET, { expiresIn: '14d' });

// Browsers can't send an Authorization header from <img src> or a download link, so each
// attachment gets a short-lived signed URL instead.
export const signFileToken = (attachmentId) => jwt.sign({ att: attachmentId }, SECRET, { expiresIn: '2h' });

export function verifyFileToken(token, attachmentId) {
  try {
    return jwt.verify(String(token || ''), SECRET).att === attachmentId;
  } catch {
    return false;
  }
}

// Git provider tokens are encrypted at rest with a key derived from the app secret.
const TOKEN_KEY = crypto.createHash('sha256').update(`${SECRET}:repository-tokens`).digest();

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', TOKEN_KEY, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(stored) {
  if (!stored) return null;
  try {
    const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', TOKEN_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null; // secret changed since the token was saved
  }
}

export function publicUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired, please sign in again' });
  }
  const user = await get('SELECT * FROM users WHERE id = ?', Number(payload.sub));
  if (!user || !user.active) return res.status(401).json({ error: 'Account not found or disabled' });
  req.user = publicUser(user);
  next();
}

export const isManager = (user) => user.role === 'admin' || user.role === 'manager';

/** Managers and the project's owner can change its plan and repositories. */
export const canManageProject = (user, project) => isManager(user) || project.owner_id === user.id;

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'You do not have permission to do that' });
