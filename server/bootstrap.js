import bcrypt from 'bcryptjs';
import { get, run, tx } from './db.js';

export const DEFAULT_SPACES = [
  { name: 'Software Development', color: '#7b68ee', description: 'Product engineering, releases, bugs and infrastructure.' },
  { name: 'SEO', color: '#10b981', description: 'Technical SEO, content, keyword research and link building.' },
  { name: 'Digital Marketing', color: '#f59e0b', description: 'Paid ads, social media, email and campaign execution.' },
  { name: 'Operations', color: '#3b82f6', description: 'Hiring, finance, admin and internal processes.' },
];

/** On an empty database, create the first admin account and the default spaces. */
export async function bootstrap() {
  if ((await get('SELECT COUNT(*) AS n FROM users')).n > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@instacall.local';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  await tx(async () => {
    await run(
      "INSERT INTO users (name, email, password_hash, role, title, color) VALUES (?, ?, ?, 'admin', 'Administrator', '#7b68ee')",
      process.env.ADMIN_NAME || 'Admin', email, bcrypt.hashSync(password, 10),
    );
    if ((await get('SELECT COUNT(*) AS n FROM spaces')).n === 0) {
      for (const [i, s] of DEFAULT_SPACES.entries()) {
        await run('INSERT INTO spaces (name, description, color, position) VALUES (?, ?, ?, ?)', s.name, s.description, s.color, i + 1);
      }
    }
  });
  console.log(`\n  Created admin account: ${email} / ${password}\n  Change this password after your first sign-in.\n`);
}
