import * as auth from '@/server/api/auth.js';
import { handle } from '@/server/http.js';

export const POST = handle(auth.login, { auth: false });
