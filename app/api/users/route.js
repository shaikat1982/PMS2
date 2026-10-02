import * as users from '@/server/api/users.js';
import { handle } from '@/server/http.js';

export const GET = handle(users.list);
export const POST = handle(users.create);
