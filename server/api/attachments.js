import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { DATA_DIR, all, get, insert, run, tx } from '../db.js';
import { isManager, signFileToken, verifyFileToken } from '../auth.js';
import { notify } from '../notify.js';
import { HttpError, badRequest, created, forbidden, idParam, logActivity, notFound } from '../util.js';

export const ATTACHMENT_DIR = path.join(DATA_DIR, 'attachments');

const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 25;

// Only these types are shown in the browser; anything else (HTML, SVG, scripts…) is always
// downloaded, so an uploaded file can never run code on the app's origin.
const INLINE_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'application/pdf',
  'text/plain', 'text/csv', 'application/json', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/ogg',
]);

const cleanName = (name) => String(name || 'file').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim().slice(0, 200) || 'file';

export async function attachmentsFor(taskId) {
  return (await all(
    `SELECT a.id, a.task_id, a.user_id, a.filename, a.mime, a.size, a.created_at, u.name AS user_name, u.color AS user_color
     FROM attachments a LEFT JOIN users u ON u.id = a.user_id WHERE a.task_id = ? ORDER BY a.id DESC`,
    taskId,
  )).map((a) => ({ ...a, url: `/api/files/${a.id}?token=${signFileToken(a.id)}`, inline: INLINE_TYPES.has(a.mime) }));
}

/** Public download, authorised by the signed token in the URL (img/iframe/download links can't send headers). */
export async function download({ params, query }) {
  const id = idParam(params.id);
  if (!verifyFileToken(query.token, id)) throw new HttpError(403, 'This download link has expired. Reopen the task to get a new one.');
  const att = await get('SELECT * FROM attachments WHERE id = ?', id);
  if (!att) throw notFound('Attachment');
  const file = path.join(ATTACHMENT_DIR, att.storage_key);
  if (!fs.existsSync(file)) throw notFound('File');
  const inline = INLINE_TYPES.has(att.mime) && query.download === undefined;
  const encoded = encodeURIComponent(att.filename);
  const headers = {
    'Content-Type': inline ? att.mime : 'application/octet-stream',
    'Content-Length': String(att.size),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encoded}"; filename*=UTF-8''${encoded}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=3600',
  };
  if (inline && att.mime !== 'application/pdf') {
    headers['Content-Security-Policy'] = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { headers });
}

/**
 * Upload one file per request with the raw bytes as the body. The client sends the
 * file name in X-File-Name (URI-encoded) and its type in X-File-Type.
 */
export async function upload({ user, params, request }) {
  const task = await get('SELECT * FROM tasks WHERE id = ?', idParam(params.id));
  if (!task) throw notFound('Task');
  const tooLarge = () => new HttpError(413, `Files can be at most ${MAX_MB} MB`);
  if (Number(request.headers.get('content-length')) > MAX_MB * 1024 * 1024) throw tooLarge();
  const data = Buffer.from(await request.arrayBuffer());
  if (!data.length) throw badRequest('The file is empty');
  if (data.length > MAX_MB * 1024 * 1024) throw tooLarge();
  let filename;
  try {
    filename = cleanName(decodeURIComponent(request.headers.get('x-file-name') || 'file'));
  } catch {
    filename = 'file';
  }
  const mime = (request.headers.get('x-file-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase().slice(0, 100);
  const storageKey = `${task.id}-${crypto.randomBytes(16).toString('hex')}`;
  await fs.promises.mkdir(ATTACHMENT_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(ATTACHMENT_DIR, storageKey), data);

  const id = await tx(async () => {
    const newId = await insert(
      'INSERT INTO attachments (task_id, user_id, filename, mime, size, storage_key) VALUES (?, ?, ?, ?, ?, ?)',
      task.id, user.id, filename, mime, data.length, storageKey,
    );
    await logActivity({ taskId: task.id, projectId: task.project_id, userId: user.id, action: `attached ${filename}` });
    const watchers = [...(await all('SELECT user_id FROM task_assignees WHERE task_id = ?', task.id)).map((r) => r.user_id), task.created_by];
    await notify(watchers, user.id, task.id, `${user.name} attached ${filename} to "${task.title}"`, 'attachment');
    await run('UPDATE tasks SET updated_at = now() WHERE id = ?', task.id);
    return newId;
  });
  return created((await attachmentsFor(task.id)).find((a) => a.id === id));
}

export async function remove({ user, params }) {
  const att = await get('SELECT * FROM attachments WHERE id = ?', idParam(params.id));
  if (!att) throw notFound('Attachment');
  if (att.user_id !== user.id && !isManager(user)) throw forbidden();
  const task = await get('SELECT project_id FROM tasks WHERE id = ?', att.task_id);
  await tx(async () => {
    await run('DELETE FROM attachments WHERE id = ?', att.id);
    await logActivity({ taskId: att.task_id, projectId: task?.project_id, userId: user.id, action: `removed attachment ${att.filename}` });
  });
  fs.rm(path.join(ATTACHMENT_DIR, att.storage_key), { force: true }, () => {});
}

/**
 * Deleting a task, project or space removes attachment rows through foreign keys; this
 * sweeps up the files they leave behind. Files younger than an hour are skipped so an
 * upload that is still being saved is never touched.
 */
export async function cleanOrphanFiles() {
  if (!fs.existsSync(ATTACHMENT_DIR)) return;
  const known = new Set((await all('SELECT storage_key FROM attachments')).map((a) => a.storage_key));
  const cutoff = Date.now() - 3600 * 1000;
  for (const name of fs.readdirSync(ATTACHMENT_DIR)) {
    if (known.has(name)) continue;
    const file = path.join(ATTACHMENT_DIR, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    } catch { /* already gone */ }
  }
}
