import * as tasks from '@/server/api/tasks.js';
import { handle } from '@/server/http.js';

export const DELETE = handle(tasks.removeTime);
