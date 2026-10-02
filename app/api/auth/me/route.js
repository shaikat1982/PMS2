import * as auth from '@/server/api/auth.js';
import { handle } from '@/server/http.js';

export const GET = handle(auth.me);
export const PATCH = handle(auth.updateMe);
