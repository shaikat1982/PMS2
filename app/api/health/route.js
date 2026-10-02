import { get } from '@/server/db.js';
import { handle } from '@/server/http.js';

/** For load balancers and uptime checks: 200 when the app and database are up. */
export const GET = handle(async () => {
  await get('SELECT 1 AS ok');
  return { ok: true };
}, { auth: false });
