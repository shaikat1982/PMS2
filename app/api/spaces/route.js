import * as spaces from '@/server/api/spaces.js';
import { handle } from '@/server/http.js';

export const GET = handle(spaces.list);
export const POST = handle(spaces.create);
