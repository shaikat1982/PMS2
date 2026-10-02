import * as tasks from '@/server/api/tasks.js';
import { handle } from '@/server/http.js';

export const GET = handle(tasks.list);
export const POST = handle(tasks.create);
