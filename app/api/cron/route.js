import { HttpError } from '@/server/util.js';
import { handle } from '@/server/http.js';
import { processQueue } from '@/server/mailer.js';
import { runHourlyJobs } from '@/server/reminders.js';

/**
 * Runs the background jobs (due/overdue reminders, email outbox, attachment cleanup) on
 * request. Self-hosted servers run these on a timer already; serverless hosts such as Vercel
 * should call this from a scheduled job with "Authorization: Bearer $CRON_SECRET".
 */
export const GET = handle(async ({ request }) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) throw new HttpError(401, 'Not authorized');
  await runHourlyJobs();
  await processQueue();
  return { ok: true };
}, { auth: false });
