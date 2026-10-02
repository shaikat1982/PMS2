import * as projects from '@/server/api/projects.js';
import { handle } from '@/server/http.js';

export const GET = handle(projects.list);
export const POST = handle(projects.create);
