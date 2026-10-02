import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireAuth } from './auth.js';
import { bootstrap } from './bootstrap.js';
import { DATABASE_URL, migrate, pool } from './db.js';
import { startMailer } from './mailer.js';
import { startJobs } from './reminders.js';
import { errorHandler } from './util.js';
import attachmentsRoutes, { filesRouter } from './routes/attachments.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import teamsRoutes from './routes/teams.js';
import spacesRoutes from './routes/spaces.js';
import projectsRoutes from './routes/projects.js';
import planningRoutes from './routes/planning.js';
import gitRoutes, { webhookRouter } from './routes/git.js';
import tasksRoutes from './routes/tasks.js';
import dashboardRoutes from './routes/dashboard.js';
import notificationsRoutes from './routes/notifications.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3001;

try {
  await migrate();
  await bootstrap();
} catch (err) {
  const where = DATABASE_URL.replace(/\/\/[^@/]*@/, '//***@');
  console.error(`\n  Could not prepare the database at ${where}\n  ${err.message}`);
  console.error('  Check that PostgreSQL is running and DATABASE_URL is correct (see README).\n');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');

// Public endpoints, mounted before the JSON parser and auth: webhooks verify their own
// signature against the raw body, and file downloads carry a signed token.
app.use('/api/webhooks', webhookRouter);
app.use('/api/files', filesRouter);

app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api', requireAuth);
app.use('/api/users', usersRoutes);
app.use('/api/teams', teamsRoutes);
app.use('/api/spaces', spacesRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api', planningRoutes);
app.use('/api', gitRoutes);
app.use('/api', attachmentsRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built frontend in production (npm run build).
const dist = path.resolve(__dirname, '../dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(dist, 'index.html')) : next()));
}

app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`Instacall PM API listening on http://localhost:${PORT}`);
  startMailer();
  startJobs();
});

// Finish in-flight requests and close database connections on shutdown.
const shutdown = () => {
  server.close(() => pool.end().finally(() => process.exit(0)));
  server.closeIdleConnections();
  setTimeout(() => process.exit(0), 10000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
