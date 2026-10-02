// Runs once when a Next.js server process starts: bring the database schema up to date,
// create the first admin if needed, and start the email and reminder background jobs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const { startServer } = await import('./server/startup.js');
  try {
    await startServer();
  } catch {
    // Already logged; API requests retry the database setup until it succeeds.
  }
}
