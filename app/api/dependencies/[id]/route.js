import * as planning from '@/server/api/planning.js';
import { handle } from '@/server/http.js';

export const DELETE = handle(planning.removeDependency);
