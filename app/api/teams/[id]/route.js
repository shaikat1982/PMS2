import * as teams from '@/server/api/teams.js';
import { handle } from '@/server/http.js';

export const PATCH = handle(teams.update);
export const DELETE = handle(teams.remove);
