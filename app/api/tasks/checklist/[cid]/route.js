import * as tasks from '@/server/api/tasks.js';
import { handle } from '@/server/http.js';

export const PATCH = handle(tasks.updateChecklistItem);
export const DELETE = handle(tasks.removeChecklistItem);
