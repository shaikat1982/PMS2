import * as planning from '@/server/api/planning.js';
import { handle } from '@/server/http.js';

export const POST = handle(planning.milestones.create);
