import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import jwt from 'jsonwebtoken';
import { DATA_DIR, get } from './db.js';
import { HttpError } from './util.js';

// Loaded on first use (not at import), so `next build` never reads or writes the secret file.
let secretValue;
function secret() {
  if (secretValue) return secretValue;
  if (process.env.JWT_SECRET) return (secretValue = process.env.JWT_SECRET);
  const file = path.join(DATA_DIR, '.jwt-secret');
  if (fs.existsSync(file)) return (secretValue = fs.readFileSync(file, 'utf8').trim());
  fs.mkdirSync(DATA_DIR, { recursive: true });
  secretValue = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secretValue, { mode: 0o600 });
  return secretValue;
}

export const signToken = (user) => jwt.sign({ sub: String(user.id) }, secret(), { expiresIn: '14d' });

// Browsers can't send an Authorization header from <img src> or a download link, so each
// attachment gets a short-lived signed URL instead.
export const signFileToken = (attachmentId) => jwt.sign({ att: attachmentId }, secret(), { expiresIn: '2h' });

export function verifyFileToken(token, attachmentId) {
  try {
    return jwt.verify(String(token || ''), secret()).att === attachmentId;
  } catch {
    return false;
  }
}

// Git provider tokens are encrypted at rest with a key derived from the app secret.
const tokenKey = () => crypto.createHash('sha256').update(`${secret()}:repository-tokens`).digest();

export function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(stored) {
  if (!stored) return null;
  try {
    const [iv, tag, data] = stored.split('.').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
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

/** The signed-in user for a request (from "Authorization: Bearer <token>"), or a 401 error. */
export async function authenticate(request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Not authenticated');
  let payload;
  try {
    payload = jwt.verify(token, secret());
  } catch {
    throw new HttpError(401, 'Session expired, please sign in again');
  }
  const user = await get('SELECT * FROM users WHERE id = ?', Number(payload.sub));
  if (!user || !user.active) throw new HttpError(401, 'Account not found or disabled');
  return publicUser(user);
}

export const isManager = (user) => user.role === 'admin' || user.role === 'manager';

/** Managers and the project's owner can change its plan and repositories. */
export const canManageProject = (user, project) => isManager(user) || project.owner_id === user.id;

/** Throw 403 unless the user has one of the roles. */
export function requireRole(user, ...roles) {
  if (!roles.includes(user.role)) throw new HttpError(403, 'You do not have permission to do that');
}
