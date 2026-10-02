// One-time import of an old SQLite database (data/instacall.db) into PostgreSQL.
//
//   npm run import:sqlite -- path/to/instacall.db
//
// The target database (DATABASE_URL) must be empty: run this before using the new install.
// Reading the SQLite file uses Node's built-in node:sqlite (Node 22.13 or later).
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TABLES, migrate, pool, run, tx } from '../db.js';

const file = path.resolve(process.argv[2] || path.join(process.env.DATA_DIR || 'data', 'instacall.db'));
const source = new DatabaseSync(file, { readOnly: true });

// SQLite stored these as 0/1 integers; PostgreSQL uses real booleans.
const BOOLEAN_COLUMNS = new Set(['users.active', 'checklist_items.done', 'notifications.read', 'tasks.is_key', 'notification_prefs.in_app', 'notification_prefs.email']);
// SQLite stored timestamps as UTC text without a zone ("2026-01-31 14:05:00").
const isUtcStamp = (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(v);

const sourceTables = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name));

await migrate();
const existing = (await pool.query('SELECT COUNT(*) AS n FROM users')).rows[0].n;
if (existing > 0) {
  console.error('The PostgreSQL database already has data. Import into an empty database (new DATABASE_URL), or reset it first.');
  process.exit(1);
}

const counts = {};
await tx(async () => {
  for (const table of TABLES) {
    if (!sourceTables.has(table)) continue;
    const targetColumns = new Set((await pool.query(
      'SELECT column_name FROM information_schema.columns WHERE table_name = $1', [table],
    )).rows.map((c) => c.column_name));
    const rows = source.prepare(`SELECT * FROM ${table}`).all();
    for (const row of rows) {
      const cols = Object.keys(row).filter((c) => targetColumns.has(c));
      const values = cols.map((c) => {
        const v = row[c];
        if (BOOLEAN_COLUMNS.has(`${table}.${c}`)) return v === null ? null : Boolean(v);
        if (isUtcStamp(v) && /(_at)$/.test(c)) return `${v.replace(' ', 'T')}Z`;
        return v;
      });
      await run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, ...values);
    }
    counts[table] = rows.length;
    // Continue numbering after the imported ids.
    if (targetColumns.has('id')) {
      await run(`SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`);
    }
  }
});

console.log(`Imported from ${file}:`);
for (const [table, n] of Object.entries(counts)) console.log(`  ${table.padEnd(20)} ${n}`);
console.log('\nAttachments: copy the old data/attachments folder to DATA_DIR/attachments on the new server.');
await pool.end();
