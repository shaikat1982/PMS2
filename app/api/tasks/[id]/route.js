import * as tasks from '@/server/api/tasks.js';
import { handle } from '@/server/http.js';

export const GET = handle(tasks.show);
export const PATCH = handle(tasks.update);
export const DELETE = handle(tasks.remove);
