import * as spaces from '@/server/api/spaces.js';
import { handle } from '@/server/http.js';

export const PATCH = handle(spaces.update);
export const DELETE = handle(spaces.remove);
