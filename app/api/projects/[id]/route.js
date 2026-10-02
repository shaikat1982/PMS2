import * as projects from '@/server/api/projects.js';
import { handle } from '@/server/http.js';

export const GET = handle(projects.show);
export const PATCH = handle(projects.update);
export const DELETE = handle(projects.remove);
