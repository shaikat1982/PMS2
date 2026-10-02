import nodemailer from 'nodemailer';
import { all, get, run } from './db.js';

// Email is queued in the email_queue table and sent by a background worker, so a slow
// or unreachable SMTP server never blocks a request and failed sends are retried.

const SMTP_HOST = process.env.SMTP_HOST;
const PORT = Number(process.env.SMTP_PORT) || 587;
export const MAIL_FROM = process.env.MAIL_FROM || process.env.SMTP_USER || 'Instacall PM <no-reply@instacall.local>';
// Links in emails point here. Set APP_URL in production to the address people open the app at.
export const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
const MAX_ATTEMPTS = 5;

export const mailEnabled = () => Boolean(SMTP_HOST);

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: PORT,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : PORT === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
    });
  }
  return transport;
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Wrap a notification in a simple, email-client-safe HTML layout. */
export function renderEmail({ heading, lines = [], quote, actionUrl, actionLabel = 'Open in Instacall PM' }) {
  const text = [heading, '', ...lines, ...(quote ? ['', `"${quote}"`] : []), ...(actionUrl ? ['', `${actionLabel}: ${actionUrl}`] : []),
    '', '—', `You can change which emails you get under Inbox → Notification settings: ${APP_URL}/inbox`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f7f8fa;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f2330">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e8ee;border-radius:10px">
<tr><td style="padding:16px 24px;border-bottom:1px solid #e6e8ee;font-weight:600;font-size:15px">Instacall <span style="color:#7b68ee">PM</span></td></tr>
<tr><td style="padding:24px">
<p style="margin:0 0 12px;font-size:16px;font-weight:600">${escapeHtml(heading)}</p>
${lines.map((l) => `<p style="margin:0 0 6px;font-size:14px;color:#4b5263">${escapeHtml(l)}</p>`).join('')}
${quote ? `<blockquote style="margin:14px 0;padding:10px 14px;background:#f3f4f7;border-left:3px solid #7b68ee;border-radius:4px;font-size:14px;white-space:pre-wrap">${escapeHtml(quote)}</blockquote>` : ''}
${actionUrl ? `<p style="margin:20px 0 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#7b68ee;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600;font-size:14px">${escapeHtml(actionLabel)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px;border-top:1px solid #e6e8ee;font-size:12px;color:#8a90a0">You can change which emails you get under <a href="${APP_URL}/inbox" style="color:#7b68ee">Inbox → Notification settings</a>.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}

export async function queueEmail(to, subject, { text, html }) {
  if (!mailEnabled() || !to) return;
  await run('INSERT INTO email_queue (to_email, subject, body_text, body_html) VALUES (?, ?, ?, ?)', to, subject.slice(0, 250), text, html);
}

let sending = false;
async function processQueue() {
  if (sending || !mailEnabled()) return;
  sending = true;
  try {
    // Claim a batch with a 10-minute lease. SKIP LOCKED keeps several app instances from
    // sending the same email; if this process dies mid-send, the mail is retried after the lease.
    const batch = await all(
      `UPDATE email_queue SET next_attempt_at = now() + interval '10 minutes'
       WHERE id IN (
         SELECT id FROM email_queue WHERE status = 'pending' AND next_attempt_at <= now()
         ORDER BY id LIMIT 20 FOR UPDATE SKIP LOCKED
       ) RETURNING *`,
    );
    for (const mail of batch) {
      try {
        await getTransport().sendMail({ from: MAIL_FROM, to: mail.to_email, subject: mail.subject, text: mail.body_text, html: mail.body_html });
        await run("UPDATE email_queue SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = ?", mail.id);
      } catch (err) {
        const attempts = mail.attempts + 1;
        // Back off 1, 4, 9, 16 minutes, then give up.
        await run(
          'UPDATE email_queue SET attempts = ?, last_error = ?, status = ?, next_attempt_at = now() + ?::interval WHERE id = ?',
          attempts, String(err.message).slice(0, 500), attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', `${attempts * attempts} minutes`, mail.id,
        );
        console.error(`Email to ${mail.to_email} failed (attempt ${attempts}): ${err.message}`);
      }
    }
    // Keep the outbox small: drop delivered mail after 30 days.
    await run("DELETE FROM email_queue WHERE status = 'sent' AND sent_at < now() - interval '30 days'");
  } finally {
    sending = false;
  }
}

export function startMailer() {
  if (!mailEnabled()) {
    console.log('  Email notifications are off. Set SMTP_HOST (and SMTP_USER, SMTP_PASS, MAIL_FROM) to turn them on.');
    return;
  }
  console.log(`  Email notifications are on (SMTP ${SMTP_HOST}:${PORT}).`);
  setInterval(() => processQueue().catch((e) => console.error(e)), 15000).unref();
  processQueue().catch((e) => console.error(e));
}

export async function mailStatus() {
  const counts = await get(
    `SELECT COUNT(*) FILTER (WHERE status = 'pending') AS pending, COUNT(*) FILTER (WHERE status = 'failed') AS failed,
       COUNT(*) FILTER (WHERE status = 'sent') AS sent FROM email_queue`,
  );
  return { enabled: mailEnabled(), from: mailEnabled() ? MAIL_FROM : null, ...counts };
}
