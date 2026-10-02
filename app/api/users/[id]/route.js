import * as users from '@/server/api/users.js';
import { handle } from '@/server/http.js';

export const PATCH = handle(users.update);
