import * as planning from '@/server/api/planning.js';
import { handle } from '@/server/http.js';

export const PATCH = handle(planning.milestones.update);
export const DELETE = handle(planning.milestones.remove);
