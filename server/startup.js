import { bootstrap } from './bootstrap.js';
import { DATABASE_URL, migrate } from './db.js';
import { startMailer } from './mailer.js';
import { startJobs } from './reminders.js';

/**
 * Resolves once the database schema is up to date and the first admin exists. Every API
 * request awaits it (it is instant after the first time), so the app works even on hosts
 * where instrumentation.js doesn't run first.
 */
export function ready() {
  globalThis.__instacallReady ??= (async () => {
    await migrate();
    await bootstrap();
  })().catch((err) => {
    globalThis.__instacallReady = null; // retry on the next request
    const where = DATABASE_URL.replace(/\/\/[^@/]*@/, '//***@');
    console.error(`\n  Could not prepare the database at ${where}\n  ${err.message}`);
    console.error('  Check that PostgreSQL is running and DATABASE_URL is correct (see README).\n');
    throw err;
  });
  return globalThis.__instacallReady;
}

/** Called once per server process from instrumentation.js: prepare the database, then start background jobs. */
export async function startServer() {
  await ready();
  startMailer();
  startJobs();
}
