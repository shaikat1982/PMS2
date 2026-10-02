import * as teams from '@/server/api/teams.js';
import { handle } from '@/server/http.js';

export const GET = handle(teams.list);
export const POST = handle(teams.create);
